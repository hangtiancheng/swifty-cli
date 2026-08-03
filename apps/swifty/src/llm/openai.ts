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

import OpenAI from "openai";

import { getMaxOutputTokens, type ProviderConfig, resolveAPIKey } from "../config/config.js";
import type {
  ConversationManager,
  Message,
  ToolResultBlock,
} from "../conversation/conversation.js";
import { ensureToolPairing } from "../conversation/pairing.js";
import { createChildLogger } from "../logger/index.js";
import {
  asRecord,
  asString,
  contentToText,
  DANGEROUSLY_JSON,
  isRecord,
  strArg,
} from "../utils/index.js";

import type { LLMClient } from "./client.js";
import {
  AuthenticationError,
  ContextTooLongError,
  LLMError,
  NetworkError,
  RateLimitError,
} from "./errors.js";
import type { StreamEvent } from "./events.js";

import type { ToolSchema } from "@/tools/types.js";

const log = createChildLogger({ module: "llm" });

enum OpenAIErrorCode {
  /** 413 Payload Too Large — The request entity is larger than the server is willing or able to process. */
  PromptTooLong = 413,
  /** 401 Unauthorized — The request lacks valid authentication credentials. */
  InvalidAPIKey = 401,
  /** 429 Too Many Requests — The client has sent too many requests in a given amount of time, triggering rate limiting. */
  RateLimitError = 429,
  /** 400 Bad Request — The request was invalid or malformed. */
  BadRequest = 400,
}

export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private model: string;
  private systemPrompt: string;
  private maxOutputTokens: number;

  constructor(config: ProviderConfig, systemPrompt: string) {
    const apiKey = resolveAPIKey(config);
    if (!apiKey) {
      throw new AuthenticationError(
        "OpenAI API key not found, set OPENAI_API_KEY in .swifty/config.y(a)ml, or via OPENAI_API_KEY env variable.",
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: config.base_url,
    });
    this.model = config.model;
    this.systemPrompt = systemPrompt;
    this.maxOutputTokens = getMaxOutputTokens(config);
  }
  async *stream(
    conversation: ConversationManager,
    toolSchemas: ToolSchema[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    // Reconcile tool-call/result pairing before sending the request, for the same reasons as the Anthropic branch
    const messages = buildOpenAIInput(ensureToolPairing(conversation.getMessages()));

    const input: OpenAI.Responses.ResponseCreateParamsStreaming["input"] = [];
    input.push({
      role: "system" as const,
      content: this.systemPrompt,
    });

    for (const message of messages) {
      input.push(message);
    }

    const tools: OpenAI.Responses.FunctionTool[] = toolSchemas.map((s) => {
      const schema = s.input_schema;
      return {
        type: "function" as const,
        name: s.name,
        description: s.description,
        parameters: schema,
        strict: false,
      };
    });

    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: this.model,
      input,
      stream: true,
      max_output_tokens: this.maxOutputTokens,
      ...(tools.length > 0 ? { tools } : {}),
    };

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    // There is no cache_creation concept here, so it stays 0.
    const cacheCreationInputTokens = 0;

    try {
      const stream = await this.client.responses.create(params, {
        ...(abortSignal ? { signal: abortSignal } : {}),
      });

      let currentToolName = "";
      let currentToolId = "";
      let jsonAccumulate = "";
      let reasoningId = "";
      let reasoningText = "";

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield {
            type: "text_delta",
            text: event.delta,
          };
        } // end if (event.type === "response.output_text.delta")
        else if (event.type === "response.reasoning_summary_text.delta") {
          reasoningText += event.delta;
          yield { type: "thinking_delta", text: event.delta };
        } else if (event.type === "response.reasoning_summary_text.done") {
          yield {
            type: "thinking_complete",
            thinking: reasoningText,
            signature: reasoningId,
          };
        } else if (event.type === "response.function_call_arguments.delta") {
          jsonAccumulate += event.delta;
          yield {
            type: "tool_call_delta",
            text: event.delta,
          };
        } // end if (event.type === "response.function_call_arguments.delta")
        else if (event.type === "response.output_item.added") {
          if (event.item.type === "function_call") {
            currentToolName = event.item.name;
            currentToolId = event.item.call_id;
            jsonAccumulate = "";

            yield {
              type: "tool_call_start",
              toolName: currentToolName,
              toolId: currentToolId,
            };
          } else if (event.item.type === "reasoning") {
            reasoningId = event.item.id ?? "";
            reasoningText = "";
          }
        } // end if (event.type === "response.output_item.added")
        else if (event.type === "response.output_item.done") {
          if (event.item.type === "function_call" && currentToolName) {
            let args: Record<string, unknown> = {};
            if (jsonAccumulate) {
              try {
                const parsed: unknown = JSON.parse(jsonAccumulate);
                args = isRecord(parsed) ? asRecord(parsed) : { [DANGEROUSLY_JSON]: jsonAccumulate };
              } catch (err) {
                log.error({ err }, "llm operation failed");
                args = {
                  [DANGEROUSLY_JSON]: jsonAccumulate,
                };
              }
            }

            yield {
              type: "tool_call_complete",
              toolId: currentToolId,
              toolName: currentToolName,
              arguments: args,
            };

            // Reset
            currentToolName = "";
            currentToolId = "";
            jsonAccumulate = "";
          }
        } // end if (event.type === "response.output_item.done")
        else if (event.type === "response.completed") {
          const usage = event.response.usage;
          if (usage) {
            outputTokens = usage.output_tokens;

            // Responses API exposes the cached prefix via
            // input_tokens_details.cached_tokens, absent -> 0.
            // There is no cache_creation concept here, so it stays 0.
            cacheReadInputTokens = usage.input_tokens_details.cached_tokens;

            // input_tokens already includes the cached prefix;
            // subtract so the usage anchor (input + cache_read) doesn't double-count it.
            inputTokens = Math.max(0, usage.input_tokens - cacheReadInputTokens);
          } // end if (usage)

          // Parse the actual stop reason from the Responses API.
          // When the response status is "incomplete",
          // check incomplete_details.reason
          // for 'max_output_tokens' so the agent loop's max_tokens recovery can trigger.
          // Otherwise default to "end_turn".
          let stopReason = "end_turn";
          const resp = event.response;
          if (resp.status === "incomplete") {
            // 'max_output_tokens' | 'content_filter'
            const details = resp.incomplete_details;
            if (details?.reason === "max_output_tokens") {
              stopReason = "max_tokens";
            }
          }

          yield {
            type: "stream_end",
            stopReason,
            usage: {
              inputTokens,
              outputTokens,
              cacheReadInputTokens,
              cacheCreationInputTokens, // 0
            },
          };
        } // end if (event.type === "response.completed")
      }
    } catch (err) {
      log.error({ err }, "llm operation failed");
      throw classifyOpenAIError(err);
    }
  }
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }
  setMaxOutputTokens(maxTokens: number): void {
    this.maxOutputTokens = maxTokens;
  }
}

// OpenAI.Responses.ResponseInputContent;

// Official Responses API input item types, narrowed to the variants this
// converter actually emits (the full ResponseInputItem union is much wider).
export type OpenAIMessageParam =
  | OpenAI.Responses.EasyInputMessage
  | OpenAI.Responses.ResponseFunctionToolCall
  | OpenAI.Responses.ResponseInputItem.FunctionCallOutput
  | OpenAI.Responses.ResponseReasoningItem;

// Extract a data URL from an image content block (Record form). Returns null
// for non-image blocks or malformed sources.
function imageDataUrl(block: Record<string, unknown>): string | null {
  if (block.type !== "image") {
    return null;
  }
  const source = block.source;
  if (!isRecord(source) || source.type !== "base64") {
    return null;
  }
  const mediaType = strArg(source, "media_type");
  const data = strArg(source, "data");
  if (!mediaType || !data) {
    return null;
  }
  return `data:${mediaType};base64,${data}`;
}

function collectImageContents(tr: ToolResultBlock): OpenAI.Responses.ResponseInputContent[] {
  const { toolUseId, content } = tr;
  if (typeof content === "string") {
    return [];
  }
  const images: OpenAI.Responses.ResponseInputContent[] = [];
  for (const block of content) {
    const url = imageDataUrl(block);
    if (url) {
      images.push({
        type: "input_image",
        image_url: url,
        detail: "auto",
      });
    }
  }
  if (images.length === 0) {
    return [];
  }
  return [
    {
      type: "input_text",
      text: `[Image(s) returned by tool call ${toolUseId}]`,
    },
    ...images,
  ];
}

function collectImageParts(tr: ToolResultBlock): OpenAI.ChatCompletionContentPart[] {
  const { toolUseId, content } = tr;
  if (typeof content === "string") {
    return [];
  }
  const images: OpenAI.ChatCompletionContentPart[] = [];
  for (const block of content) {
    const url = imageDataUrl(block);
    if (url) {
      images.push({
        type: "image_url",
        image_url: { url },
      });
    }
  }
  if (images.length === 0) {
    return [];
  }
  return [
    {
      type: "text",
      text: `[Image(s) returned by tool call ${toolUseId}]`,
    },
    ...images,
  ];
}

// User message content → Responses API parts. Text blocks become input_text,
// image blocks become input_image data URLs; other block types are dropped.
function userContentsFor(
  content: Message["content"],
): string | OpenAI.Responses.ResponseInputContent[] {
  if (typeof content === "string") {
    return content;
  }
  const parts: OpenAI.Responses.ResponseInputContent[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "input_text", text: strArg(block, "text") });
    } else {
      const url = imageDataUrl(block);
      if (url) {
        parts.push({ type: "input_image", image_url: url, detail: "auto" });
      }
    }
  }
  return parts;
}

// User message content → Chat Completions parts (text / image_url).
function userPartsFor(content: Message["content"]): string | OpenAI.ChatCompletionContentPart[] {
  if (typeof content === "string") {
    return content;
  }
  const parts: OpenAI.ChatCompletionContentPart[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: strArg(block, "text") });
    } else {
      const url = imageDataUrl(block);
      if (url) {
        parts.push({ type: "image_url", image_url: { url } });
      }
    }
  }
  return parts;
}

// Convert Swifty's conversation into Responses API input items:
// assistant tool calls become function_call items and
// tool results become function_call_output items,
// so multi-turn tool use works over the Responses endpoint.
export function buildOpenAIInput(messages: Message[]): OpenAIMessageParam[] {
  const result: OpenAIMessageParam[] = [];
  for (const m of messages) {
    if (m.thinkingBlocks) {
      for (const tb of m.thinkingBlocks) {
        result.push({
          type: "reasoning",
          id: tb.signature,
          summary: [{ type: "summary_text", text: tb.thinking }],
        } satisfies OpenAIMessageParam);
      }
    }

    if (m.toolUses && m.toolUses.length > 0) {
      const assistantText = typeof m.content === "string" ? m.content : contentToText(m.content);
      if (assistantText) {
        result.push({
          role: "assistant",
          content: assistantText,
        });
      }

      for (const tu of m.toolUses) {
        result.push({
          type: "function_call",
          name: tu.toolName,
          call_id: tu.toolUseId,
          arguments: JSON.stringify(tu.arguments),
        });
      }
    } // end if (m.toolUses && m.toolUses.length > 0)
    else if (m.toolResults && m.toolResults.length > 0) {
      const pendingImageContents: OpenAI.Responses.ResponseInputContent[] = [];
      for (const tr of m.toolResults) {
        result.push({
          type: "function_call_output",
          call_id: tr.toolUseId,
          output: contentToText(tr.content),
        });
        pendingImageContents.push(...collectImageContents(tr));
      }
      if (pendingImageContents.length > 0) {
        result.push({
          role: "user",
          content: pendingImageContents,
        });
      }
    } // end if (m.toolResults && m.toolResults.length > 0)
    else if (m.role === "assistant") {
      result.push({
        role: "assistant",
        content: typeof m.content === "string" ? m.content : contentToText(m.content),
      });
    } else {
      result.push({
        role: m.role,
        content: userContentsFor(m.content),
      });
    }
  }

  return result;
}

function containsContextLengthError(msg: string): boolean {
  return (
    /context_length_exceeded/i.test(msg) ||
    /maximum\scontext\slength/i.test(msg) ||
    /prompts?\s+too\s+long/i.test(msg)
  );
}

// Convert Swifty's conversation into Chat Completions messages,
// preserving assistant tool_calls and tool-result (role: "tool") turns so multi-turn tool use works over the openai-compat (Chat Completions) endpoint.
export class OpenAICompatClient implements LLMClient {
  private client: OpenAI;
  private model: string;
  private systemPrompt: string;
  private maxOutputTokens: number;

  constructor(config: ProviderConfig, systemPrompt: string) {
    const apiKey = resolveAPIKey(config);
    if (!apiKey) {
      throw new AuthenticationError(
        "OpenAI API key not found. Set OPENAI_API_KEY in .swifty/config.y(a)ml, or via OPENAI_API_KEY env variable.",
      );
    }
    this.client = new OpenAI({ apiKey, baseURL: config.base_url });
    this.model = config.model;
    this.systemPrompt = systemPrompt;
    this.maxOutputTokens = getMaxOutputTokens(config);
  }
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }
  setMaxOutputTokens(maxTokens: number): void {
    this.maxOutputTokens = maxTokens;
  }

  async *stream(
    conversation: ConversationManager,
    toolSchemas: ToolSchema[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: this.systemPrompt,
      },

      ...buildChatCompletionMessages(ensureToolPairing(conversation.getMessages())),
    ];

    const tools: OpenAI.ChatCompletionTool[] = toolSchemas.map((ts) => ({
      // name: ts.name,
      // description: ts.description,
      type: "function" as const,
      function: {
        name: ts.name,
        description: ts.description,
        arguments: ts.input_schema,
      },
    }));

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: this.maxOutputTokens,
      ...(tools.length > 0 ? { tools } : {}),
    };

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    // There is no cache_creation concept here, so it stays 0.
    const cacheCreationInputTokens = 0;

    try {
      const stream = await this.client.chat.completions.create(params, {
        ...(abortSignal ? { signal: abortSignal } : {}),
      });

      const toolCalls = new Map<
        number,
        {
          id: string;
          name: string;
          args: string;
        }
      >();

      /** enum: "length" | "tool_calls" */
      let finishReason: string | null = null;
      let reasoningAccumulate = "";

      for await (const chunk of stream) {
        // Usage may arrive in a trailing chunk with empty choices,
        // so check it before the delta guard.
        if (chunk.usage) {
          outputTokens = chunk.usage.completion_tokens ?? 0;
          cacheReadInputTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
          inputTokens = Math.max(0, (chunk.usage.prompt_tokens ?? 0) - cacheReadInputTokens);
        }

        if (chunk.choices.length === 0) {
          continue;
        }
        const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta =
          chunk.choices[0].delta;
        if (delta.content) {
          yield { type: "text_delta", text: delta.content };
        } // end if (delta.content)

        // const reasoningContent = delta.reasoning_content;
        const reasoningContent = strArg(asRecord(delta), "reasoning_content");
        if (reasoningContent) {
          reasoningAccumulate += reasoningContent;
          yield { type: "thinking_delta", text: reasoningContent };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCalls.has(tc.index)) {
              toolCalls.set(tc.index, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                args: "",
              });

              if (tc.id) {
                yield {
                  type: "tool_call_start",
                  toolName: tc.function?.name ?? "",
                  toolId: tc.id ?? "",
                };
              }
            } // end if (!toolCalls.has(tc.index))

            const existing = toolCalls.get(tc.index);
            if (existing) {
              if (tc.id) {
                existing.id = tc.id;
              }

              if (tc.function?.name) {
                existing.name = tc.function.name;
              }

              if (tc.function?.arguments) {
                existing.args += tc.function.arguments;
                yield {
                  type: "tool_call_delta",
                  text: tc.function.arguments,
                };
              }
            } // end if (existing)
          }
        } // end if (delta.tool_calls)

        if (chunk.choices[0].finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
          if (reasoningAccumulate) {
            yield {
              type: "thinking_complete",
              thinking: reasoningAccumulate,
              signature: "",
            };
            reasoningAccumulate = "";
          }
          for (const tu of toolCalls.values()) {
            let args: Record<string, unknown> = {};
            const jsonArgs = tu.args;
            if (jsonArgs) {
              try {
                const parsed: unknown = JSON.parse(jsonArgs);
                args = isRecord(parsed) ? asRecord(parsed) : { [DANGEROUSLY_JSON]: jsonArgs };
              } catch (err) {
                log.error({ err }, "llm operation failed");
                args = {
                  [DANGEROUSLY_JSON]: jsonArgs,
                };
              }
              yield {
                type: "tool_call_complete",
                toolName: tu.name,
                toolId: tu.id,
                arguments: args,
              };
            }
          }
        }
      }

      // Map Chat Completions finish_reason to Swifty's internal stop reason.
      // "length" means the model hit max_tokens
      // "tool_calls" means tool use;
      // "stop" (or anything else) means normal end_turn

      let stopReason: string;
      if (finishReason === "length") {
        stopReason = "max_tokens";
      } else if (finishReason === "tool_calls" || toolCalls.size > 0) {
        stopReason = "tool_use";
      } else {
        stopReason = "end_turn";
      }

      yield {
        type: "stream_end",
        stopReason,
        usage: {
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
        },
      };
    } catch (err) {
      log.error({ err }, "llm operation failed");
      throw classifyOpenAIError(err);
    }
  }
}
function classifyOpenAIError(err: unknown) {
  if (err instanceof OpenAI.APIError) {
    if (
      err.status === OpenAIErrorCode.PromptTooLong ||
      (err.status === OpenAIErrorCode.BadRequest && containsContextLengthError(err.message))
    ) {
      return new ContextTooLongError(`Context Too Long: ${err.message}`);
    }

    if (err.status === OpenAIErrorCode.InvalidAPIKey) {
      return new AuthenticationError(`Invalid API key: ${err.message}`);
    }

    if (err.status === OpenAIErrorCode.RateLimitError) {
      return new RateLimitError(`Rate limit error, please wait.`);
    }

    return new LLMError(`OpenAI API error (${asString(err.status)}): ${err.message}`);
  }

  return new NetworkError(`Network error: ${err instanceof Error ? err.message : asString(err)}`);
}

// Convert Swifty's conversation into Chat Completions messages,
// preserving assistant tool_calls and tool_results (role: "tool") turns
// so multi-turn tool use works over the openai-compat (Chat Completions) endpoint.

export function buildChatCompletionMessages(
  messages: Message[],
): OpenAI.ChatCompletionMessageParam[] {
  const params: OpenAI.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    const reasoning = m.thinkingBlocks?.map((tb) => tb.thinking).join("") ?? "";
    const assistantText = typeof m.content === "string" ? m.content : contentToText(m.content);

    if (m.toolUses && m.toolUses.length > 0) {
      params.push({
        role: "assistant",
        content: assistantText || null,
        tool_calls: m.toolUses.map((tu) => ({
          id: tu.toolUseId,
          type: "function" as const,
          function: {
            name: tu.toolName,
            arguments: JSON.stringify(tu.arguments),
          },
          ...(reasoning
            ? {
                reasoning_content: reasoning,
              }
            : {}),
        })),
      });
    } // end if (m.toolUses && m.toolUses.length > 0)
    else if (m.toolResults && m.toolResults.length > 0) {
      const pendingImageParts: OpenAI.ChatCompletionContentPart[] = [];
      for (const tr of m.toolResults) {
        params.push({
          role: "tool",
          tool_call_id: tr.toolUseId,
          content: contentToText(tr.content),
        });
        pendingImageParts.push(...collectImageParts(tr));
      }
      if (pendingImageParts.length > 0) {
        params.push({
          role: "user",
          content: pendingImageParts,
        });
      }
    } // end if (m.toolResults && m.toolResults.length > 0)
    else if (m.role === "assistant") {
      params.push({
        role: "assistant",
        content: assistantText,
        ...(reasoning
          ? {
              reasoning_content: reasoning,
            }
          : {}),
      });
    } // end if (m.role === "assistant")
    else if (m.role === "system") {
      params.push({
        role: "system",
        content: typeof m.content === "string" ? m.content : contentToText(m.content),
      });
    } else {
      params.push({
        role: "user",
        content: userPartsFor(m.content),
      });
    }
  }
  return params;
}
