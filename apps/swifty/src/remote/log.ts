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

// Unified structured logging for AgentEvent streams.
//
// Every discrete agent event becomes ONE JSONL line:
//   { "event": "tool_use", "tool": "Bash", ..., "time": <pino timestamp> }
// High-frequency stream_text/thinking_text chunks are NOT logged per chunk —
// they are aggregated and flushed as a single line at the next boundary
// (tool use, turn or loop completion), with a truncated text preview.

import type { AgentEvent } from "../agent/events.js";
import type { UsageInfo } from "../llm/events.js";
import { contentToText } from "../utils/index.js";

/** Minimal pino Logger shape (info/debug/error) to keep this module generic. */
export interface EventLogger {
  info(obj: Record<string, unknown>): void;
  debug(obj: Record<string, unknown>): void;
  error(obj: Record<string, unknown>): void;
}

/** Max characters of aggregated text kept in a log line. */
const TEXT_PREVIEW_CHARS = 800;

function preview(text: string): string {
  if (text.length <= TEXT_PREVIEW_CHARS) {
    return text;
  }
  return `${text.slice(0, TEXT_PREVIEW_CHARS)}… (+${String(text.length - TEXT_PREVIEW_CHARS)} chars)`;
}

export class AgentEventLogger {
  private streamBuf = "";
  private turns = 0;

  constructor(private readonly log: EventLogger) {}

  /** Log one AgentEvent as a structured JSONL line (chunks are aggregated). */
  onEvent(ev: AgentEvent): void {
    switch (ev.type) {
      case "stream_text":
        this.streamBuf += ev.text;
        return;

      case "thinking_text":
        // Superseded by thinking_complete, which carries the full text.
        return;

      case "thinking_complete":
        this.log.info({
          event: "thinking_complete",
          chars: ev.thinking.length,
          text: preview(ev.thinking),
        });
        return;

      case "tool_use":
        this.flushAssistantText();
        this.log.info({ event: "tool_use", tool: ev.toolName, toolId: ev.toolId });
        return;

      case "tool_result": {
        const output = contentToText(ev.output);
        this.log.info({
          event: "tool_result",
          tool: ev.toolName,
          toolId: ev.toolId,
          isError: ev.isError,
          elapsedMs: Math.round(ev.elapsed * 1000),
          outputChars: output.length,
          output: preview(output),
        });
        return;
      }

      case "turn_complete":
        this.flushAssistantText();
        this.turns += 1;
        this.log.info({ event: "turn_complete", turn: this.turns });
        return;

      case "loop_complete":
        this.flushAssistantText();
        this.log.info({
          event: "loop_complete",
          stopReason: ev.stopReason,
          turns: this.turns,
        });
        this.turns = 0;
        return;

      case "usage":
        this.log.info({ event: "usage", ...usageFields(ev.usage) });
        return;

      case "error":
        this.log.error({ event: "error", err: ev.error });
        return;

      case "compact":
        this.log.info({ event: "compact", message: ev.message });
        return;

      case "retry":
        this.log.info({ event: "retry", reason: ev.reason, delayMs: ev.delay });
        return;

      case "permission_request":
        this.log.info({ event: "permission_request", tool: ev.toolName });
        return;
    }
  }

  /** Flush any aggregated assistant text as a single line. */
  private flushAssistantText(): void {
    if (!this.streamBuf) {
      return;
    }
    const text = this.streamBuf;
    this.streamBuf = "";
    this.log.info({
      event: "assistant_text",
      chars: text.length,
      text: preview(text),
    });
  }
}

/** Extract numeric token fields from UsageInfo without unsafe access. */
function usageFields(usage: UsageInfo): Record<string, unknown> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  };
}
