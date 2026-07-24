/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Anthropic LLM provider: streaming calls with prompt caching and retry logic
import process from "node:process";

import Anthropic, { APIError } from "@anthropic-ai/sdk";

import type { EventBus } from "../events/bus.js";
import { isAbortError } from "../errors.js";
import { getLogger } from "../logging.js";
import type { LLMProvider } from "./base.js";
import type { LlmResponse, ToolUseBlock, UsageStats } from "./types.js";
import type { TextBlockParam, ToolUnion } from "@anthropic-ai/sdk/resources";

// Model context window size mapping
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-opus-4-7": 200_000,
};

const MAX_STREAM_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

const SYSTEM_PROMPT =
  "You are a helpful AI assistant. " +
  "Use the available tools to complete the user's goal. " +
  "When the goal is fully achieved, respond with a final answer and do not call any more tools.";

// Return the max context window token count for a given model
function contextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 200_000;
}

// Return current UTC timestamp as ISO 8601 string
function now(): string {
  return new Date().toISOString();
}

// Wait for the specified number of milliseconds
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// HTTP statuses worth retrying: rate limit (429), transient server errors
// (500/502/503) and Anthropic "overloaded" (529). Other 4xx (400/401/403/404/422)
// are deterministic business errors and must not be retried.
const RETRYABLE_API_STATUSES = new Set([429, 500, 502, 503, 529]);

// Check if an error is a transient failure worth retrying: either a retryable
// API business error (429/5xx/529) or a socket-level network failure.
// Abort errors (user cancellation) are never retryable.
function isRetryableError(exc: unknown): boolean {
  if (!(exc instanceof Error)) return false;
  if (isAbortError(exc)) return false;
  // Anthropic SDK API errors carry an HTTP status (RateLimitError = 429,
  // InternalServerError = 5xx, ...). Retry only the transient statuses.
  // APIError instances without a numeric status (e.g. APIConnectionError)
  // fall through to the socket-level checks below.
  if (exc instanceof APIError && typeof exc.status === "number") {
    return RETRYABLE_API_STATUSES.has(exc.status);
  }
  const code = "code" in exc && typeof exc.code === "string" ? exc.code : undefined;
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  const msg = exc.message.toLowerCase();
  return msg.includes("socket hang up") || msg.includes("connection reset");
}

export class AnthropicProvider implements LLMProvider {
  private _client: Anthropic;
  private _model: string;

  // Initialize Anthropic client; inject client for testing to skip API key check
  constructor(model: string, client?: Anthropic) {
    if (client) {
      this._client = client;
    } else {
      const apiKey = process.env["ANTHROPIC_API_KEY"];
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY not set");
      }
      const baseURL = process.env["ANTHROPIC_BASE_URL"];
      this._client = new Anthropic({
        ...(baseURL ? { baseURL } : {}),
        apiKey,
      });
    }
    this._model = model;
  }

  // Stream Anthropic API call, emit events per token, return LlmResponse; auto-retry on network failures
  async chat(
    messages: Anthropic.MessageParam[],
    toolSchemas: ToolUnion[],
    bus: EventBus,
    runId: string,
    options?: { step?: number; system?: string | null; signal?: AbortSignal },
  ): Promise<LlmResponse> {
    const step = options?.step ?? 0;
    const system = options?.system ?? null;
    const signal = options?.signal;

    await bus.publish({
      type: "llm.model_selected",
      run_id: runId,
      model: this._model,
      strategy: "static",
      timestamp: now(),
    });

    // Build system blocks with prompt caching
    const systemBlocks: TextBlockParam[] = [
      {
        type: "text",
        text: system ?? SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ];

    // Build tools array; last tool gets cache_control
    const tools: ToolUnion[] = [...toolSchemas];
    if (tools.length > 0) {
      const lastIdx = tools.length - 1;
      const last = { ...tools[lastIdx] };
      last.cache_control = { type: "ephemeral" };
      tools[lastIdx] = last;
    }

    // Build request parameters
    const args: Anthropic.MessageCreateParamsStreaming = {
      model: this._model,
      max_tokens: 8192,
      system: systemBlocks,
      messages,
      stream: true,
    };
    if (tools.length > 0) {
      args.tools = tools;
    }

    let textParts: string[] = [];
    let finalMessage: Anthropic.Message | null = null;

    for (let attempt = 1; attempt <= MAX_STREAM_RETRIES; attempt++) {
      textParts = [];
      try {
        // Forward the AbortSignal as a request option so cancellation
        // interrupts the in-flight stream (SDK throws APIUserAbortError)
        const stream = this._client.messages.stream(args, { signal: signal ?? null });

        // Collect tokens via text event (MessageStream has no textStream property)
        // Only publish token events on the first attempt to avoid TUI duplicates
        const isFirstAttempt = attempt === 1;
        stream.on("text", (textDelta) => {
          if (isFirstAttempt) {
            void bus.publish({
              type: "llm.token",
              run_id: runId,
              token: textDelta,
              timestamp: now(),
            });
          }
          textParts.push(textDelta);
        });

        finalMessage = await stream.finalMessage();
        break;
      } catch (exc) {
        if (!isRetryableError(exc)) {
          throw exc;
        }
        if (attempt === MAX_STREAM_RETRIES) {
          getLogger().error(
            { run_id: runId, step, err: exc },
            `stream failed after ${String(MAX_STREAM_RETRIES)} attempts`,
          );
          throw exc;
        }
        const delay = RETRY_BACKOFF_MS[attempt - 1] ?? 0;
        getLogger().warn(
          { run_id: runId, step },
          `stream dropped (attempt ${String(attempt)}/${String(MAX_STREAM_RETRIES)}): ${String(exc)} — retrying in ${String(delay)}ms`,
        );
        await sleep(delay);
      }
    }

    if (!finalMessage) {
      throw new Error("LLM stream failed: no final message");
    }

    const usage = finalMessage.usage;
    const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
    const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
    // Context usage must include cached input tokens: on cache hits the API
    // reports most of the prompt under cache_read/cache_creation, so counting
    // only input_tokens would systematically under-estimate auto-compact triggers
    const contextPercent =
      (usage.input_tokens + cacheReadInputTokens + cacheCreationInputTokens) /
      contextWindow(this._model);

    await bus.publish({
      type: "llm.usage",
      run_id: runId,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: cacheReadInputTokens,
      cache_creation_input_tokens: cacheCreationInputTokens,
      context_percent: contextPercent,
      timestamp: now(),
    });

    const toolUses: ToolUseBlock[] = [];
    const thinkingBlocks: (Anthropic.ThinkingBlock | Anthropic.RedactedThinkingBlock)[] = [];

    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        toolUses.push(block);
      } else if (block.type === "thinking" || block.type === "redacted_thinking") {
        // redacted_thinking blocks must be preserved and passed back verbatim,
        // otherwise multi-turn extended thinking conversations break
        thinkingBlocks.push(block);
      }
    }

    const usageStats: UsageStats = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      contextPercent,
    };

    return {
      stopReason: finalMessage.stop_reason ?? "end_turn",
      toolUses,
      text: textParts.join(""),
      usage: usageStats,
      thinkingBlocks,
    };
  }
}
