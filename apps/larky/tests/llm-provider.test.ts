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

import { describe, expect, test } from "vitest";
import { APIError } from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../src/core/llm/provider.js";
import { EventBus } from "../src/core/events/bus.js";
import type Anthropic from "@anthropic-ai/sdk";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.entries());
  }
  return {};
}

function isAnthropic(value: unknown): value is Anthropic {
  if (!isRecord(value)) {
    return false;
  }
  if (!("messages" in value)) {
    return false;
  }
  if (!isRecord(value["messages"])) {
    return false;
  }
  if (!("stream" in value["messages"])) {
    return false;
  }
  return typeof value["messages"]["stream"] === "function";
}

// Mock MessageStream: emits text events and returns a final message
function makeMockStream(opts: {
  textChunks?: string[];
  stopReason?: string;
  toolUses?: { id: string; name: string; input: Record<string, unknown> }[];
  thinkingBlocks?: { thinking: string }[];
  redactedThinkingBlocks?: { data: string }[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  throwError?: Error;
}) {
  const textChunks = opts.textChunks ?? [];
  const stopReason = opts.stopReason ?? "end_turn";
  const toolUses = opts.toolUses ?? [];
  const thinkingBlocks = opts.thinkingBlocks ?? [];
  const redactedThinkingBlocks = opts.redactedThinkingBlocks ?? [];
  const usage = opts.usage ?? {
    input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  let textHandler: ((delta: string) => void) | null = null;

  const stream = {
    on(event: string, handler: (delta: string) => void) {
      if (event === "text") {
        textHandler = handler;
      }
      return stream;
    },
    finalMessage() {
      if (opts.throwError) throw opts.throwError;

      // Emit all text chunks
      if (textHandler) {
        for (const chunk of textChunks) {
          textHandler(chunk);
        }
      }

      // Build content blocks
      const content: unknown[] = [];
      for (const tu of toolUses) {
        content.push({ type: "tool_use", ...tu });
      }
      for (const tb of thinkingBlocks) {
        content.push({ type: "thinking", ...tb });
      }
      for (const rb of redactedThinkingBlocks) {
        content.push({ type: "redacted_thinking", ...rb });
      }

      return {
        stop_reason: stopReason,
        usage,
        content,
      };
    },
  };

  return stream;
}

// Mock Anthropic client with configurable stream behavior
function makeMockClient(streamFactory: () => ReturnType<typeof makeMockStream>) {
  return {
    messages: {
      stream: () => streamFactory(),
    },
  };
}

// Helper: create AnthropicProvider with mock client (type-safe wrapper)
function makeProvider(
  model: string,
  streamFactory: () => ReturnType<typeof makeMockStream>,
): AnthropicProvider {
  const mockClient = makeMockClient(streamFactory);
  if (!isAnthropic(mockClient)) {
    throw new Error("Mock client failed Anthropic type guard");
  }
  return new AnthropicProvider(model, mockClient);
}

// Helper: collect events from bus
function collectEvents(bus: EventBus): unknown[] {
  const events: unknown[] = [];
  bus.subscribe((e) => {
    events.push(e);
    return Promise.resolve();
  });
  return events;
}

describe("AnthropicProvider", () => {
  // --- Constructor tests ---

  test("throws without ANTHROPIC_API_KEY", () => {
    const orig = process.env["ANTHROPIC_API_KEY"];
    Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
    try {
      expect(() => new AnthropicProvider("claude-sonnet-4-6")).toThrow("ANTHROPIC_API_KEY not set");
    } finally {
      if (orig !== undefined) process.env["ANTHROPIC_API_KEY"] = orig;
    }
  });

  test("succeeds with injected client", () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["hello"] }),
    );
    expect(provider).toBeDefined();
    expect(typeof provider.chat).toBe("function");
  });

  // --- chat() event publishing ---

  test("chat publishes llm.model_selected event", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["hi"] }),
    );
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    const selected = events.find((e: unknown) => asRecord(e)["type"] === "llm.model_selected");
    expect(selected).toBeDefined();
    expect(asRecord(selected)["model"]).toBe("claude-sonnet-4-6");
  });

  test("chat publishes llm.token events per chunk", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["Hello", " ", "world"] }),
    );
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    const tokens = events.filter((e: unknown) => asRecord(e)["type"] === "llm.token");
    expect(tokens).toHaveLength(3);
    expect(asRecord(tokens[0])["token"]).toBe("Hello");
    expect(asRecord(tokens[1])["token"]).toBe(" ");
    expect(asRecord(tokens[2])["token"]).toBe("world");
  });

  test("chat publishes llm.usage event with correct counts", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({
        textChunks: ["test"],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 10,
        },
      }),
    );
    const bus = new EventBus();
    const events = collectEvents(bus);

    await provider.chat([], [], bus, "run-1");

    const usage = events.find((e: unknown) => asRecord(e)["type"] === "llm.usage");
    expect(usage).toBeDefined();
    expect(asRecord(usage)["input_tokens"]).toBe(100);
    expect(asRecord(usage)["output_tokens"]).toBe(50);
    expect(asRecord(usage)["cache_read_input_tokens"]).toBe(30);
    expect(asRecord(usage)["cache_creation_input_tokens"]).toBe(10);
  });

  // Feature (B-1): context_percent must include cached input tokens
  // Design: 100 uncached + 50k cache-read + 10k cache-creation on a 200k window
  //         => 60100/200000; counting only input_tokens would report 100/200000
  test("context_percent includes cache read and creation tokens", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({
        textChunks: ["ok"],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 50_000,
          cache_creation_input_tokens: 10_000,
        },
      }),
    );
    const bus = new EventBus();
    const events = collectEvents(bus);

    const response = await provider.chat([], [], bus, "run-1");

    const expected = (100 + 50_000 + 10_000) / 200_000;
    expect(response.usage?.contextPercent).toBeCloseTo(expected, 10);
    const usageEvent = events.find((e: unknown) => asRecord(e)["type"] === "llm.usage");
    expect(asRecord(usageEvent)["context_percent"]).toBeCloseTo(expected, 10);
  });

  // Feature (B-1): missing cache fields are treated as 0
  // Design: usage without cache fields => context_percent falls back to input_tokens only
  test("context_percent treats missing cache fields as zero", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({
        textChunks: ["ok"],
        usage: { input_tokens: 2_000, output_tokens: 10 },
      }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.usage?.contextPercent).toBeCloseTo(2_000 / 200_000, 10);
  });

  // --- chat() response parsing ---

  test("chat returns correct stopReason", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["done"], stopReason: "end_turn" }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.stopReason).toBe("end_turn");
  });

  test("chat accumulates text from tokens", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({ textChunks: ["Hello", " ", "world", "!"] }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.text).toBe("Hello world!");
  });

  test("chat extracts tool_use blocks", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({
        textChunks: [],
        stopReason: "tool_use",
        toolUses: [
          { id: "tool-use-1", name: "bash", input: { command: "ls" } },
          { id: "tool-use-2", name: "read_file", input: { path: "test.txt" } },
        ],
      }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.toolUses).toHaveLength(2);
    expect(response.toolUses[0].name).toBe("bash");
    expect(response.toolUses[1].name).toBe("read_file");
    expect(response.stopReason).toBe("tool_use");
  });

  test("chat extracts thinking blocks", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({
        textChunks: ["answer"],
        thinkingBlocks: [{ thinking: "Let me think about this..." }],
      }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.thinkingBlocks).toHaveLength(1);
    const block = response.thinkingBlocks[0];
    expect(block.type).toBe("thinking");
    expect(block.type === "thinking" ? block.thinking : "").toBe("Let me think about this...");
  });

  // Feature (B-5): redacted_thinking blocks are collected instead of silently dropped
  // Design: Mock stream returns thinking + redacted_thinking blocks; both must be
  //         preserved in order so they can be passed back verbatim to the API
  test("chat preserves redacted_thinking blocks", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () =>
      makeMockStream({
        textChunks: ["answer"],
        thinkingBlocks: [{ thinking: "visible reasoning" }],
        redactedThinkingBlocks: [{ data: "opaque-encrypted-payload" }],
      }),
    );
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.thinkingBlocks).toHaveLength(2);
    const redacted = response.thinkingBlocks.find((b) => b.type === "redacted_thinking");
    expect(redacted).toBeDefined();
    expect(redacted?.type === "redacted_thinking" ? redacted.data : "").toBe(
      "opaque-encrypted-payload",
    );
  });

  test("chat returns empty text for no tokens", async () => {
    const provider = makeProvider("claude-sonnet-4-6", () => makeMockStream({ textChunks: [] }));
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.text).toBe("");
  });

  // --- Retry behavior (tests the Phase 1.1 fix) ---

  test("non-retryable error propagates immediately without retry", async () => {
    let callCount = 0;
    const mockClient = {
      messages: {
        stream: () => {
          callCount++;
          return makeMockStream({
            throwError: Object.assign(new Error("401 Unauthorized"), {
              code: "AUTH_ERROR",
            }),
          });
        },
      },
    };
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();

    await expect(provider.chat([], [], bus, "run-1")).rejects.toThrow("401 Unauthorized");
    expect(callCount).toBe(1); // No retry
  });

  test("network error triggers retry", async () => {
    let callCount = 0;
    const mockClient = {
      messages: {
        stream: () => {
          callCount++;
          if (callCount === 1) {
            // First attempt: network error
            return makeMockStream({
              throwError: Object.assign(new Error("connection reset"), {
                code: "ECONNRESET",
              }),
            });
          }
          // Second attempt: success
          return makeMockStream({ textChunks: ["recovered"] });
        },
      },
    };
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();

    const response = await provider.chat([], [], bus, "run-1");
    expect(response.text).toBe("recovered");
    expect(callCount).toBe(2); // Retried once
  });

  test("token events suppressed on retry to avoid duplicates", async () => {
    let callCount = 0;
    const mockClient = {
      messages: {
        stream: () => {
          callCount++;
          if (callCount === 1) {
            return makeMockStream({
              throwError: Object.assign(new Error("socket hang up"), {
                code: "EPIPE",
              }),
            });
          }
          return makeMockStream({ textChunks: ["retry-text"] });
        },
      },
    };
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();
    const events = collectEvents(bus);

    const response = await provider.chat([], [], bus, "run-1");

    // Text is still collected from retry, but no token events are published
    expect(response.text).toBe("retry-text");
    const tokens = events.filter((e: unknown) => asRecord(e)["type"] === "llm.token");
    expect(tokens.length).toBe(0);
  });

  test("exhausted retries throw the last error", async () => {
    const mockClient = makeMockClient(() =>
      makeMockStream({
        throwError: Object.assign(new Error("ECONNRESET"), {
          code: "ECONNRESET",
        }),
      }),
    );
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();

    await expect(provider.chat([], [], bus, "run-1")).rejects.toThrow("ECONNRESET");
  });

  // --- API business error retry (B-2) ---

  // Build a real SDK APIError subclass for a given HTTP status
  function makeApiError(status: number, message: string): Error {
    return APIError.generate(status, { error: { message } }, message, new Headers());
  }

  test.each([429, 500, 502, 503, 529])(
    "API error with status %i triggers retry",
    async (status) => {
      let callCount = 0;
      const mockClient = {
        messages: {
          stream: () => {
            callCount++;
            if (callCount === 1) {
              return makeMockStream({
                throwError: makeApiError(status, `transient ${String(status)}`),
              });
            }
            return makeMockStream({ textChunks: ["recovered"] });
          },
        },
      };
      if (!isAnthropic(mockClient)) {
        throw new Error("Mock client failed Anthropic type guard");
      }
      const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
      const bus = new EventBus();

      const response = await provider.chat([], [], bus, "run-1");
      expect(response.text).toBe("recovered");
      expect(callCount).toBe(2); // Retried once
    },
    10_000,
  );

  test.each([400, 401, 403, 404, 422])(
    "API error with status %i is not retried",
    async (status) => {
      let callCount = 0;
      const mockClient = {
        messages: {
          stream: () => {
            callCount++;
            return makeMockStream({
              throwError: makeApiError(status, `business error ${String(status)}`),
            });
          },
        },
      };
      if (!isAnthropic(mockClient)) {
        throw new Error("Mock client failed Anthropic type guard");
      }
      const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
      const bus = new EventBus();

      await expect(provider.chat([], [], bus, "run-1")).rejects.toThrow(
        `business error ${String(status)}`,
      );
      expect(callCount).toBe(1); // No retry on deterministic 4xx
    },
  );

  // --- AbortSignal pass-through (mid-LLM cancellation) ---

  test("forwards AbortSignal to SDK request options", async () => {
    const controller = new AbortController();
    let capturedOptions: unknown;
    const mockClient = {
      messages: {
        stream: (_args: unknown, options?: unknown) => {
          capturedOptions = options;
          return makeMockStream({ textChunks: ["ok"] });
        },
      },
    };
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();

    await provider.chat([], [], bus, "run-1", { signal: controller.signal });

    expect(asRecord(capturedOptions)["signal"]).toBe(controller.signal);
  });

  test("abort error is not retried as a network error", async () => {
    let callCount = 0;
    const mockClient = {
      messages: {
        stream: () => {
          callCount++;
          // SDK abort errors carry name "AbortError" / APIUserAbortError and
          // may contain "connection reset"-like messages depending on runtime;
          // classification must go by abort identity, never by message
          const abortErr = Object.assign(new Error("Request was aborted."), {
            name: "AbortError",
          });
          return makeMockStream({ throwError: abortErr });
        },
      },
    };
    if (!isAnthropic(mockClient)) {
      throw new Error("Mock client failed Anthropic type guard");
    }
    const provider = new AnthropicProvider("claude-sonnet-4-6", mockClient);
    const bus = new EventBus();

    await expect(provider.chat([], [], bus, "run-1")).rejects.toThrow("Request was aborted.");
    expect(callCount).toBe(1); // No retry on abort
  });
});
