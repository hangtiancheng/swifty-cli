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

// LLM-driven context compression: summarize conversation history to reduce token usage
import type Anthropic from "@anthropic-ai/sdk";

import { EventBus } from "../events/bus.js";
import type { LLMProvider } from "../llm/base.js";
import { getLogger } from "../logging.js";
import type { ExecutionContext } from "../context.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and the agent's previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - The agent's approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
   - Errors that were run into and how they were fixed
   - Pay special attention to specific user feedback, especially if the user asked for something to be done differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

After your analysis, output your final summary wrapped in <summary> tags. Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that were run into, and how they were fixed. Pay special attention to specific user feedback, especially if the user asked for something to be done differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that the agent has explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step to take that is related to the most recent work. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task being worked on immediately before this summary request. If the last task was concluded, then only list next steps if they are explicitly in line with the user's request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task was in progress and where it left off. This should be verbatim to ensure there's no drift in task interpretation.

Please provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response.`;

// Strip the <analysis> scratch area and unwrap <summary> tags; fall back to
// the raw text when the model omitted the expected tags
export function extractSummary(text: string): string {
  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(text);
  if (summaryMatch) return summaryMatch[1].trim();
  return text.replace(/<analysis>[\s\S]*?<\/analysis>/g, "").trim();
}

// Post-compaction message pair: continuation preamble + assistant acknowledgment
export function buildCompactedMessages(summaryText: string): Anthropic.MessageParam[] {
  return [
    {
      role: "user",
      content:
        "This session continues from a previous conversation, which has been compressed due to context limitations. " +
        `Here is a summary of the earlier messages:\n\n${summaryText}`,
    },
    {
      role: "assistant",
      content: "Understood, I'll continue from this summary.",
    },
  ];
}

export interface CompactionResult {
  summaryText: string;
  originalTokenEstimate: number;
  summaryTokens: number;
}

export class Compactor {
  private _bus: EventBus;
  private _sessionDir: string;
  private _sessionId: string;

  constructor(bus: EventBus, sessionDir: string, sessionId: string) {
    this._bus = bus;
    this._sessionDir = sessionDir;
    this._sessionId = sessionId;
  }

  // Compact ExecutionContext messages in-place, replacing with summary + acknowledgment
  async compact(
    context: ExecutionContext,
    provider: LLMProvider,
    focus = "",
  ): Promise<CompactionResult | null> {
    const result = await this.compactMessages(context.messages, provider, focus);
    if (!result) return null;

    context.messages = buildCompactedMessages(result.summaryText);
    this._writeSummary(result.summaryText);
    await this._bus.publish({
      type: "context.compacted",
      session_id: this._sessionId,
      run_id: context.runId,
      original_tokens: result.originalTokenEstimate,
      summary_tokens: result.summaryTokens,
      timestamp: new Date().toISOString(),
    });
    // Mirrors Python compactor.py post-compaction stats log
    getLogger().info(
      {
        session_id: this._sessionId,
        run_id: context.runId,
        original_tokens: result.originalTokenEstimate,
        summary_tokens: result.summaryTokens,
      },
      `context compacted session=${this._sessionId} run=${context.runId} original≈${String(result.originalTokenEstimate)} summary=${String(result.summaryTokens)} tokens`,
    );
    return result;
  }

  // Pure functional compression: takes messages, returns CompactionResult or null on failure
  async compactMessages(
    messages: Anthropic.MessageParam[],
    provider: LLMProvider,
    focus = "",
  ): Promise<CompactionResult | null> {
    const originalEstimate = messages.reduce((sum, m) => sum + this._estimateTokens(m.content), 0);

    const historyText = this._messagesToText(messages);
    let prompt = COMPACT_PROMPT;
    if (focus.trim()) {
      prompt += `\n\nIMPORTANT: Pay special attention to: ${focus.trim()}`;
    }

    const compressRequest: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `${prompt}\n\n---\n\n${historyText}`,
      },
    ];

    try {
      // Use silent bus to avoid polluting parent event stream
      const silentBus = new EventBus();
      const response = await provider.chat(compressRequest, [], silentBus, "compact", {
        step: 0,
        system: "You are a helpful assistant that summarizes agent conversations for continuation.",
      });

      const summaryText = extractSummary(response.text);
      if (!summaryText) {
        // Mirrors Python compactor.py empty-summary warning
        getLogger().warn("compactor: LLM returned empty summary, skipping compaction");
        return null;
      }

      const summaryTokens = response.usage?.outputTokens ?? Math.floor(summaryText.length / 4);

      return {
        summaryText,
        originalTokenEstimate: originalEstimate,
        summaryTokens,
      };
    } catch (error) {
      getLogger().error({ err: error }, "compactor: LLM call failed, skipping compaction");
      return null;
    }
  }

  // Estimate token count from message content (rough approximation: chars / 4)
  private _estimateTokens(content: string | Anthropic.ContentBlockParam[]): number {
    if (typeof content === "string") {
      return Math.floor(content.length / 4);
    }
    if (Array.isArray(content)) {
      return Math.floor(JSON.stringify(content).length / 4);
    }
    return 0;
  }

  // Serialize messages to human-readable text for LLM consumption
  private _messagesToText(messages: Anthropic.MessageParam[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      const role = msg.role.toUpperCase();
      const { content } = msg;
      if (typeof content === "string") {
        parts.push(`[${role}]\n${content}`);
      } else if (Array.isArray(content)) {
        const blocks: string[] = [];
        for (const block of content) {
          if (block.type === "text") {
            blocks.push(block.text);
          } else if (block.type === "tool_use") {
            blocks.push(
              `<tool_call name=${block.name} id=${block.id}>\n${JSON.stringify(block.input)}\n</tool_call>`,
            );
          } else if (block.type === "tool_result") {
            const resultContent =
              typeof block.content === "string" ? block.content : JSON.stringify(block.content);
            blocks.push(`<tool_result id=${block.tool_use_id}>\n${resultContent}\n</tool_result>`);
          }
        }
        parts.push(`[${role}]\n${blocks.join("\n")}`);
      }
    }
    return parts.join("\n\n");
  }

  // Write summary text to session directory
  private _writeSummary(text: string): void {
    try {
      mkdirSync(this._sessionDir, { recursive: true });
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[-:]/g, "")
        .replace("T", "_");
      const summaryPath = path.join(this._sessionDir, `summary_${timestamp}.md`);
      writeFileSync(summaryPath, text, "utf-8");
    } catch (error) {
      getLogger().error({ err: error }, "compactor: failed to write summary file");
    }
  }
}
