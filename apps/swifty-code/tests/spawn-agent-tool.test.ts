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
import { SpawnAgentTool, AgentResultTool } from "../src/core/subagent/tool.js";
import { BackgroundTaskRegistry } from "../src/core/subagent/registry.js";
import { EventBus } from "../src/core/events/bus.js";
import { ExecutionContext } from "../src/core/context.js";
import type { LLMProvider } from "../src/core/llm/base.js";

function stubProvider(): LLMProvider {
  return {
    chat(
      _messages: unknown[],
      _toolSchemas: unknown[],
      _bus: EventBus,
      _runId: string,
      _options?: { step?: number; system?: string | null },
    ) {
      return Promise.resolve({
        stopReason: "end_turn",
        text: "done",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          contextPercent: 0,
        },
        toolUses: [],
        thinkingBlocks: [],
      });
    },
  };
}

describe("SpawnAgentTool", () => {
  // Feature: SpawnAgentTool has correct name and schema
  // Design: Verify name is spawn_agent and schema requires description and prompt
  test("has correct metadata", () => {
    const bus = new EventBus();
    const registry = new BackgroundTaskRegistry();
    const tool = new SpawnAgentTool(
      stubProvider(),
      bus,
      "run-1",
      undefined,
      20,
      registry,
      "/tmp/runs",
      "session-1",
      0,
    );
    expect(tool.name).toBe("spawn_agent");
    expect(tool.inputSchema).toHaveProperty("properties.description");
    expect(tool.inputSchema).toHaveProperty("properties.prompt");
  });

  // Feature: SpawnAgentTool rejects nesting beyond depth 2
  // Design: Create tool at depth 2, invoke, verify error
  test("rejects nesting beyond depth 2", async () => {
    const bus = new EventBus();
    const registry = new BackgroundTaskRegistry();
    const tool = new SpawnAgentTool(
      stubProvider(),
      bus,
      "run-1",
      undefined,
      20,
      registry,
      "/tmp/runs",
      "session-1",
      2, // depth = 2 (max)
    );
    const result = await tool.invoke({
      description: "test",
      prompt: "do something",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("nesting limit");
  });
});

describe("AgentResultTool", () => {
  // Feature: AgentResultTool has correct name
  // Design: Verify name is agent_result
  test("has correct name", () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    expect(tool.name).toBe("agent_result");
  });

  // Feature: AgentResultTool returns error for unknown run_id
  // Design: Query non-existent run_id, verify error
  test("returns error for unknown run_id", async () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    const result = await tool.invoke({ run_id: "nonexistent" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown run_id");
  });

  // Feature: AgentResultTool returns 'still running' for pending task
  // Design: Register a pending task, query it, verify still running
  test("returns still running for pending task", async () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    // Register a promise that never resolves
    const ctx = new ExecutionContext({
      runId: "bg-1",
      goal: "test",
      maxSteps: 5,
    });
    registry.register(
      "bg-1",
      new Promise<void>(() => {
        // Intentionally never resolves
        void 0;
      }),
      ctx,
    );
    const result = await tool.invoke({ run_id: "bg-1" });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("still running");
  });

  // Feature: AgentResultTool returns result for completed task
  // Design: Register a completed task, query it, verify result
  test("returns result for completed task", async () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    const ctx = new ExecutionContext({
      runId: "bg-2",
      goal: "test",
      maxSteps: 5,
    });
    ctx.result = "Task completed successfully";
    ctx.markSuccess();
    registry.register("bg-2", Promise.resolve(), ctx);
    const result = await tool.invoke({ run_id: "bg-2" });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("Task completed successfully");
  });

  // Feature: AgentResultTool returns error for rejected task
  // Design: Register a rejecting promise, wait for status update, verify error message
  test("returns error for rejected task", async () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    const ctx = new ExecutionContext({
      runId: "bg-3",
      goal: "test",
      maxSteps: 5,
    });
    registry.register("bg-3", Promise.reject(new Error("task failed")), ctx);
    // Wait for microtask queue to process the rejection and update status
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await tool.invoke({ run_id: "bg-3" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("task failed");
  });

  // Feature: AgentResultTool returns cancelled message for cancelled task
  // Design: Register a pending promise, cancel it, verify cancelled message
  test("returns cancelled message for cancelled task", async () => {
    const registry = new BackgroundTaskRegistry();
    const tool = new AgentResultTool(registry);
    const ctx = new ExecutionContext({
      runId: "bg-4",
      goal: "test",
      maxSteps: 5,
    });
    registry.register(
      "bg-4",
      new Promise<void>(() => {
        // Never resolves
      }),
      ctx,
    );
    registry.cancel("bg-4");
    const result = await tool.invoke({ run_id: "bg-4" });
    expect(result.isError).toBe(true);
    expect(result.content).toBe("Subagent was cancelled.");
  });
});
