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
import { AgentRunner } from "../src/core/runner.js";
import { RunCancelledError } from "../src/core/errors.js";
import { EventBus } from "../src/core/events/bus.js";
import type { LLMProvider } from "../src/core/llm/base.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

// Shared mock config used across all runner tests
function mockConfig() {
  return {
    host: "127.0.0.1",
    port: 5520,
    logging: { level: "info", file: "", format: "text" },
    agent: { maxSteps: 5 },
    llm: { defaultModel: "claude-3", router: "static" },
    trace: { enabled: false, file: "", includeLlmPayload: false },
    permission: { timeoutS: 60 },
    compaction: {
      autoThreshold: 0.8,
      toolResultLimit: 10000,
      toolResultKeep: 5000,
    },
    mcp: { servers: [] },
  };
}

// Shared mock provider that immediately ends the turn
function mockEndTurnProvider(): LLMProvider {
  return {
    chat: () =>
      Promise.resolve({
        stopReason: "end_turn",
        toolUses: [],
        text: "Done",
        usage: null,
        thinkingBlocks: [],
      }),
  };
}

describe("AgentRunner", () => {
  // Feature: Verify AgentRunner executes a run
  // Design: Create runner with mock provider, run goal, confirm it completes with run events
  test("executes a run", async () => {
    const dir = path.join(tmpdir(), `test-runner-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => {
      events.push(e);
      return Promise.resolve();
    });
    const runner = new AgentRunner(mockConfig(), {
      provider: mockEndTurnProvider(),
      bus,
      runsDir: dir,
    });

    const outcome = await runner.runAndCapture("test goal");
    expect(outcome.status).toBe("success");
    expect(outcome.result).toBe("Done");

    const started = events.find(
      (e: unknown) => asRecord(e)["type"] === "run.started",
    );
    expect(started).toBeDefined();
    if (!started) {
      throw new Error("Expected started event to be defined");
    }
    expect(asRecord(started)["goal"]).toBe("test goal");

    const finished = events.find(
      (e: unknown) => asRecord(e)["type"] === "run.finished",
    );
    expect(finished).toBeDefined();
    if (!finished) {
      throw new Error("Expected finished event to be defined");
    }
    expect(asRecord(finished)["status"]).toBe("success");

    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify AgentRunner publishes run events
  // Design: Run goal, confirm run.started and run.finished events are published
  test("publishes run events", async () => {
    const dir = path.join(tmpdir(), `test-runner-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((event) => {
      events.push(event.type);
      return Promise.resolve();
    });
    const runner = new AgentRunner(mockConfig(), {
      provider: mockEndTurnProvider(),
      bus,
      runsDir: dir,
    });

    await runner.run("test goal");
    expect(events).toContain("run.started");
    expect(events).toContain("run.finished");
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify AgentRunner returns run outcome
  // Design: Run goal with runAndCapture, confirm outcome is returned
  test("returns run outcome", async () => {
    const dir = path.join(tmpdir(), `test-runner-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const runner = new AgentRunner(mockConfig(), {
      provider: mockEndTurnProvider(),
      bus,
      runsDir: dir,
    });

    const outcome = await runner.runAndCapture("test goal");
    expect(outcome.status).toBe("success");
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify MCP tools are registered when mcpManager is provided
  // Design: Create runner with mock mcpManager containing a tool whose LLM provider
  //         invokes that tool, then check tool.call_started event carries the MCP tool name
  test("registers MCP tools from mcpManager", async () => {
    const dir = path.join(tmpdir(), `test-runner-mcp-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();

    const toolNames: string[] = [];
    bus.subscribe((event) => {
      if (event.type === "tool.call_started") {
        const raw = event.tool_name;
        toolNames.push(raw);
      }
      return Promise.resolve();
    });

    // Mock MCP tool that returns success
    const mockMcpTool = {
      name: "test_server__search",
      description: "Search the web",
      inputSchema: { type: "object", properties: {} },
      invoke: () =>
        Promise.resolve({
          content: "search result",
          isError: false,
          errorType: null,
        }),
    };

    // Mock McpManagerLike with structural typing (no type assertion)
    const mockMcpManager = {
      getTools: () => [mockMcpTool],
    };

    // Provider that requests the MCP tool then ends
    let callCount = 0;
    const provider: LLMProvider = {
      chat: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            stopReason: "tool_use",
            toolUses: [
              {
                id: "toolu_1",
                type: "tool_use",
                name: "test_server__search",
                input: { query: "hello" },
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

    const runner = new AgentRunner(mockConfig(), {
      provider,
      bus,
      runsDir: dir,
      mcpManager: mockMcpManager,
    });

    await runner.run("search for hello");
    expect(toolNames).toContain("test_server__search");
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify MCP tools respect tool whitelist
  // Design: Create runner with mcpManager and toolWhitelist that excludes the MCP tool,
  //         confirm the tool is NOT invoked (provider requests it but it's not in registry)
  test("MCP tools respect tool whitelist", async () => {
    const dir = path.join(tmpdir(), `test-runner-mcp-wl-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();

    const toolNames: string[] = [];
    bus.subscribe((event) => {
      if (event.type === "tool.call_started") {
        const raw = event.tool_name;
        toolNames.push(raw);
      }
      return Promise.resolve();
    });

    const mockMcpTool = {
      name: "test_server__search",
      description: "Search the web",
      inputSchema: { type: "object", properties: {} },
      invoke: () =>
        Promise.resolve({
          content: "search result",
          isError: false,
          errorType: null,
        }),
    };

    const mockMcpManager = {
      getTools: () => [mockMcpTool],
    };

    const provider = mockEndTurnProvider();

    const runner = new AgentRunner(mockConfig(), {
      provider,
      bus,
      runsDir: dir,
      mcpManager: mockMcpManager,
    });

    // Run with whitelist that does NOT include the MCP tool
    await runner.runAndCapture("test", {
      toolWhitelist: ["read_file", "bash"],
    });

    // MCP tool should not have been invoked
    expect(toolNames).not.toContain("test_server__search");
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify config maxSteps propagates to ExecutionContext
  // Design: Set maxSteps=2 in config, provider always returns tool_use, confirm run stops at max_steps
  test("config maxSteps propagates to loop", async () => {
    const dir = path.join(
      tmpdir(),
      `test-runner-maxsteps-${String(Date.now())}`,
    );
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();

    let callCount = 0;
    const provider: LLMProvider = {
      chat: () => {
        callCount++;
        return Promise.resolve({
          stopReason: "tool_use",
          toolUses: [
            {
              id: `call_${String(callCount)}`,
              name: "list_dir",
              input: { path: "." },
              type: "tool_use",
              caller: { type: "direct" },
            },
          ],
          text: "",
          usage: null,
          thinkingBlocks: [],
        });
      },
    };

    const config = mockConfig();
    config.agent.maxSteps = 2;

    const runner = new AgentRunner(config, {
      provider,
      bus,
      runsDir: dir,
    });

    const outcome = await runner.runAndCapture("test");
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toContain("max_steps");
    expect(callCount).toBe(2); // Exactly maxSteps calls
    rmSync(dir, { recursive: true, force: true });
  }, 30000);

  // Feature: Verify run ID is consistent across started and finished events
  // Design: Run goal, confirm started and finished events share the same run_id
  test("run ID is consistent across events", async () => {
    const dir = path.join(tmpdir(), `test-runner-runid-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => {
      events.push(e);
      return Promise.resolve();
    });

    const runner = new AgentRunner(mockConfig(), {
      provider: mockEndTurnProvider(),
      bus,
      runsDir: dir,
    });

    await runner.run("test goal");

    const started = events.find(
      (e: unknown) => asRecord(e)["type"] === "run.started",
    );
    const finished = events.find(
      (e: unknown) => asRecord(e)["type"] === "run.finished",
    );

    expect(started).toBeDefined();
    expect(finished).toBeDefined();
    if (!started || !finished) {
      throw new Error("Expected started and finished events to be defined");
    }

    expect(asRecord(started)["run_id"]).toBeDefined();
    expect(asRecord(finished)["run_id"]).toBeDefined();
    expect(asRecord(started)["run_id"]).toBe(asRecord(finished)["run_id"]);
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify mid-LLM signal abort results in cancelled status, not llm_error
  // Design: Provider aborts the controller and rejects with an AbortError mid-call;
  //         runAndCapture must throw RunCancelledError and run.finished must carry
  //         reason "cancelled" (never overwritten to "llm_error")
  test("mid-LLM abort marks run cancelled, not llm_error", async () => {
    const dir = path.join(tmpdir(), `test-runner-cancel-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => {
      events.push(e);
      return Promise.resolve();
    });

    const controller = new AbortController();
    const provider: LLMProvider = {
      chat: () => {
        // Simulate user cancelling while the LLM request is in flight:
        // the SDK rejects with an abort-shaped error
        controller.abort();
        const err = new Error("Request was aborted.");
        err.name = "AbortError";
        return Promise.reject(err);
      },
    };

    const runner = new AgentRunner(mockConfig(), {
      provider,
      bus,
      runsDir: dir,
      signal: controller.signal,
    });

    await expect(runner.runAndCapture("test goal")).rejects.toBeInstanceOf(
      RunCancelledError,
    );

    const finished = events.find(
      (e: unknown) => asRecord(e)["type"] === "run.finished",
    );
    expect(finished).toBeDefined();
    if (!finished) {
      throw new Error("Expected finished event to be defined");
    }
    expect(asRecord(finished)["status"]).toBe("failed");
    expect(asRecord(finished)["reason"]).toBe("cancelled");
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: Verify non-abort LLM failures are still classified as llm_error
  // Design: Provider rejects with a plain error, confirm reason stays llm_error
  test("plain LLM failure still classified as llm_error", async () => {
    const dir = path.join(tmpdir(), `test-runner-llmerr-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const bus = new EventBus();

    const provider: LLMProvider = {
      chat: () => Promise.reject(new Error("API failure")),
    };

    const runner = new AgentRunner(mockConfig(), {
      provider,
      bus,
      runsDir: dir,
    });

    const outcome = await runner.runAndCapture("test goal");
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toBe("llm_error");
    rmSync(dir, { recursive: true, force: true });
  });
});
