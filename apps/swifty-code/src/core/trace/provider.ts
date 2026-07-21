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

// TracingProvider: wraps a real LLMProvider to record trace entries before/after each chat() call
import { performance } from "node:perf_hooks";

import type Anthropic from "@anthropic-ai/sdk";

import type { EventBus } from "../events/bus.js";
import type { TraceWriter } from "./writer.js";
import type { LLMProvider } from "../llm/base.js";
import type { LlmResponse } from "../llm/types.js";
import { makeApiCallTrace, makeApiResponseTrace } from "./record.js";

export class TracingProvider implements LLMProvider {
  private _inner: LLMProvider;
  private _trace: TraceWriter;
  private _includePayload: boolean;

  // Wrap a real LLMProvider to record full API I/O in TraceWriter before/after each chat() call
  constructor(inner: LLMProvider, trace: TraceWriter, includePayload = true) {
    this._inner = inner;
    this._trace = trace;
    this._includePayload = includePayload;
  }

  // Record CORE→LLM request, call real provider, record LLM→CORE response (with latency)
  async chat(
    messages: Anthropic.MessageParam[],
    toolSchemas: Anthropic.ToolUnion[],
    bus: EventBus,
    runId: string,
    options?: { step?: number; system?: string | null },
  ): Promise<LlmResponse> {
    const step = options?.step ?? 0;
    const system = options?.system ?? null;

    const callData: Record<string, unknown> = this._includePayload
      ? { messages, tool_schemas: toolSchemas, system }
      : { message_count: messages.length, tool_count: toolSchemas.length };

    this._trace.emit(makeApiCallTrace(runId, step, callData));

    const t0 = performance.now();
    const result = await this._inner.chat(messages, toolSchemas, bus, runId, {
      step,
      system,
    });
    const latencyMs = Math.round(performance.now() - t0);

    const respData: Record<string, unknown> = this._includePayload
      ? {
          stop_reason: result.stopReason,
          text: result.text,
          tool_calls: result.toolUses,
          usage: result.usage ?? {},
          latency_ms: latencyMs,
        }
      : {
          stop_reason: result.stopReason,
          usage: result.usage ?? {},
          latency_ms: latencyMs,
        };

    this._trace.emit(makeApiResponseTrace(runId, step, respData));

    return result;
  }
}
