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
import { AgentLoop } from "../src/core/loop.js";
import { RunCancelledError } from "../src/core/errors.js";
import { ExecutionContext } from "../src/core/context.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import { EventBus } from "../src/core/events/bus.js";
import type { LLMProvider } from "../src/core/llm/base.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  return {};
}

describe("AgentLoop", () => {
  // Feature: Verify AgentLoop terminates on end_turn
  // Design: Create mock provider that returns end_turn, confirm loop completes
  test("terminates on end_turn", async () => {
    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        }),
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("success");
  });

  // Feature: Verify AgentLoop stops at max_steps
  // Design: Create mock provider that always returns tool_use, confirm loop stops at max_steps
  test("stops at max_steps", async () => {
    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "tool_use",
          toolUses: [
            {
              id: "call_1",
              name: "test",
              input: {},
              type: "tool_use",
              caller: { type: "direct" },
            },
          ],
          text: "",
          usage: null,
          thinkingBlocks: [],
        }),
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 2,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("failed");
    expect(ctx.reason).toContain("max_steps");
  });

  // Feature: Verify AgentLoop executes tools
  // Design: Create mock provider that returns tool_use, confirm tool is executed
  test("executes tools", async () => {
    let toolUseed = false;
    const mockProvider: LLMProvider = {
      chat: () => {
        if (!toolUseed) {
          toolUseed = true;
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: "call_1",
                name: "test_tool",
                input: {},
                type: "tool_use",
                caller: { type: "direct" },
              },
            ],
            text: "",
            usage: null,
            thinkingBlocks: [],
          });
        }
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "test_tool",
      description: "Test tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve({ content: "result", isError: false, errorType: null }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(toolUseed).toBe(true);
  });

  // Feature: Verify AgentLoop publishes step events
  // Design: Run loop, confirm step.started and step.finished events are published
  test("publishes step events", async () => {
    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        }),
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((event) => {
      events.push(event.type);
      return Promise.resolve();
    });
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(events).toContain("step.started");
    expect(events).toContain("step.finished");
  });

  // Feature: Verify AgentLoop handles LLM errors gracefully
  // Design: Provider throws, confirm context marked as failed with "llm_error"
  test("handles LLM errors", async () => {
    const mockProvider: LLMProvider = {
      chat: () => Promise.reject(new Error("API failure")),
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("failed");
    expect(ctx.reason).toBe("llm_error");
  });

  // Feature: Verify AgentLoop continues on tool failure
  // Design: Tool returns error, confirm loop continues to next step
  test("continues on tool failure", async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: "call_1",
                name: "failing_tool",
                input: {},
                type: "tool_use",
                caller: { type: "direct" },
              },
            ],
            text: "",
            usage: null,
            thinkingBlocks: [],
          });
        }
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Recovered",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "failing_tool",
      description: "Always fails",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () =>
        Promise.resolve({
          content: "error",
          isError: true,
          errorType: "runtime_error",
        }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("success");
    expect(callCount).toBe(2); // Continued after tool failure
  });

  // Feature: Verify AgentLoop respects AbortSignal cancellation
  // Design: Abort signal during run, confirm context marked as cancelled and error thrown
  test("respects cancellation", async () => {
    const controller = new AbortController();
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          controller.abort();
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: "call_1",
                name: "test_tool",
                input: {},
                type: "tool_use",
                caller: { type: "direct" },
              },
            ],
            text: "",
            usage: null,
            thinkingBlocks: [],
          });
        }
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Should not reach",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "test_tool",
      description: "Test tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve({ content: "result", isError: false, errorType: null }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus, {
      signal: controller.signal,
    });

    await expect(loop.run(ctx)).rejects.toThrow("cancelled");
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("failed");
    expect(ctx.reason).toBe("cancelled");
  });

  // Feature: Verify mid-LLM abort is classified as cancelled, not llm_error
  // Design: Provider rejects with an AbortError while signal is aborted,
  //         confirm RunCancelledError is thrown and reason is "cancelled"
  test("mid-LLM abort classified as cancelled", async () => {
    const controller = new AbortController();
    const mockProvider: LLMProvider = {
      chat: () => {
        controller.abort();
        const err = new Error("Request was aborted.");
        err.name = "AbortError";
        return Promise.reject(err);
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus, {
      signal: controller.signal,
    });

    await expect(loop.run(ctx)).rejects.toBeInstanceOf(RunCancelledError);
    expect(ctx.isDone()).toBe(true);
    expect(ctx.status).toBe("failed");
    expect(ctx.reason).toBe("cancelled");
  });

  // Feature: Verify abort-shaped errors are treated as cancellation even
  //          without checking signal state (e.g. SDK APIUserAbortError path)
  // Design: Provider rejects with err.name === "AbortError", no aborted signal,
  //         confirm classification is still cancelled
  test("AbortError from provider classified as cancelled without aborted signal", async () => {
    const mockProvider: LLMProvider = {
      chat: () => {
        const err = new Error("Request was aborted.");
        err.name = "AbortError";
        return Promise.reject(err);
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await expect(loop.run(ctx)).rejects.toBeInstanceOf(RunCancelledError);
    expect(ctx.status).toBe("failed");
    expect(ctx.reason).toBe("cancelled");
  });

  // Feature (B-14): step.started/step.finished stay paired on mid-LLM cancellation
  // Design: Provider rejects with AbortError after step.started was published;
  //         confirm a matching step.finished is emitted before RunCancelledError
  test("pairs step events when cancelled mid-LLM", async () => {
    const controller = new AbortController();
    const mockProvider: LLMProvider = {
      chat: () => {
        controller.abort();
        const err = new Error("Request was aborted.");
        err.name = "AbortError";
        return Promise.reject(err);
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const events: { type: string; step: unknown }[] = [];
    bus.subscribe((event) => {
      events.push({ type: event.type, step: asRecord(event)["step"] });
      return Promise.resolve();
    });
    const loop = new AgentLoop(mockProvider, registry, bus, {
      signal: controller.signal,
    });

    await expect(loop.run(ctx)).rejects.toBeInstanceOf(RunCancelledError);

    const started = events.filter((e) => e.type === "step.started");
    const finished = events.filter((e) => e.type === "step.finished");
    expect(started).toHaveLength(1);
    expect(finished).toHaveLength(1);
    expect(finished[0].step).toBe(started[0].step);
  });

  // Feature (B-14): pre-step cancellation (before step.started) emits no
  //                 unpaired step events
  // Design: Signal already aborted at loop entry; confirm no step events at all
  test("no step events when cancelled before step starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const mockProvider: LLMProvider = {
      chat: () =>
        Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "unreachable",
          usage: null,
          thinkingBlocks: [],
        }),
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((event) => {
      events.push(event.type);
      return Promise.resolve();
    });
    const loop = new AgentLoop(mockProvider, registry, bus, {
      signal: controller.signal,
    });

    await expect(loop.run(ctx)).rejects.toBeInstanceOf(RunCancelledError);
    expect(events.filter((t) => t === "step.started")).toHaveLength(0);
    expect(events.filter((t) => t === "step.finished")).toHaveLength(0);
  });

  // Feature: Verify AgentLoop forwards its AbortSignal to provider.chat
  // Design: Capture options passed to chat, confirm signal is present
  test("passes signal to provider.chat", async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const mockProvider: LLMProvider = {
      chat: (_messages, _tools, _bus, _runId, options) => {
        capturedSignal = options?.signal;
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus, {
      signal: controller.signal,
    });

    await loop.run(ctx);
    expect(capturedSignal).toBe(controller.signal);
  });

  // Feature: Verify AgentLoop propagates is_error flag
  // Design: Tool returns isError=true, confirm flag is preserved in tool result
  test("propagates is_error flag", async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: "call_1",
                name: "error_tool",
                input: {},
                type: "tool_use",
                caller: { type: "direct" },
              },
            ],
            text: "",
            usage: null,
            thinkingBlocks: [],
          });
        }
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "error_tool",
      description: "Returns error",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () =>
        Promise.resolve({
          content: "failed",
          isError: true,
          errorType: "runtime_error",
        }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);

    // Check context.messages for tool_result with is_error flag
    const toolResultMsg = ctx.messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => {
          const record = asRecord(b);
          return record["type"] === "tool_result";
        }),
    );
    expect(toolResultMsg).toBeDefined();
    if (!toolResultMsg || !Array.isArray(toolResultMsg.content)) {
      throw new Error("Expected toolResultMsg with array content");
    }
    const content = toolResultMsg.content;
    const toolResult = content.find((b) => {
      const record = asRecord(b);
      return record["type"] === "tool_result";
    });
    expect(toolResult).toBeDefined();
    if (!toolResult) {
      throw new Error("Expected toolResult to be defined");
    }
    const resultRecord = asRecord(toolResult);
    expect(resultRecord["is_error"]).toBe(true);
  });

  // Feature: Verify AgentLoop increments step counter
  // Design: Run multi-step loop, confirm step counter increments correctly
  test("increments step counter", async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: `call_${String(callCount)}`,
                name: "test_tool",
                input: {},
                type: "tool_use",
                caller: { type: "direct" },
              },
            ],
            text: "",
            usage: null,
            thinkingBlocks: [],
          });
        }
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "test_tool",
      description: "Test tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve({ content: "result", isError: false, errorType: null }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);
    expect(ctx.step).toBe(3);
    expect(callCount).toBe(3);
  });

  // Feature: Verify AgentLoop handles max_tokens with tool_use
  // Design: Provider returns max_tokens with tool_use, confirm error tool result added
  test("handles max_tokens with tool_use", async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stopReason: "max_tokens",
            toolUses: [
              {
                id: "call_1",
                name: "test_tool",
                input: {},
                type: "tool_use",
                caller: { type: "direct" },
              },
            ],
            text: "",
            usage: null,
            thinkingBlocks: [],
          });
        }
        return Promise.resolve({
          stopReason: "end_turn",
          toolUses: [],
          text: "Done",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const ctx = new ExecutionContext({
      runId: "r1",
      goal: "test",
      maxSteps: 5,
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "test_tool",
      description: "Test tool",
      inputSchema: { type: "object" as const, properties: {} },
      invoke: () => Promise.resolve({ content: "result", isError: false, errorType: null }),
    });
    const bus = new EventBus();
    const loop = new AgentLoop(mockProvider, registry, bus);

    await loop.run(ctx);

    // Check context.messages for error tool_result from max_tokens
    const toolResultMsg = ctx.messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => {
          const record = asRecord(b);
          return record["type"] === "tool_result" && record["is_error"] === true;
        }),
    );
    expect(toolResultMsg).toBeDefined();
    if (!toolResultMsg || !Array.isArray(toolResultMsg.content)) {
      throw new Error("Expected toolResultMsg with array content");
    }
    const content = toolResultMsg.content;
    const errorResult = content.find((b) => {
      const record = asRecord(b);
      return record["type"] === "tool_result" && record["is_error"] === true;
    });
    expect(errorResult).toBeDefined();
    if (!errorResult) {
      throw new Error("Expected errorResult to be defined");
    }
    const errorRecord = asRecord(errorResult);
    expect(errorRecord["content"]).toContain("output token limit");
  });
});
