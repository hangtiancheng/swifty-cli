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

// End-to-end integration test for the agent pipeline.
// Uses a mock LLM provider to avoid requiring a real ANTHROPIC_API_KEY.
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { AgentRunner } from "../src/core/runner.js";
import { isRecord } from "../src/core/bus/envelope.js";
import type { SwiftyConfig } from "../src/core/config.js";
import type { LLMProvider } from "../src/core/llm/base.js";
import type { LlmResponse } from "../src/core/llm/types.js";
import type { EventBus } from "../src/core/events/bus.js";

function makeConfig(overrides?: Partial<SwiftyConfig>): SwiftyConfig {
  return {
    host: "127.0.0.1",
    port: 5520,
    logging: { level: "INFO", file: "/dev/null", format: "text" },
    agent: { maxSteps: 5 },
    llm: { defaultModel: "claude-sonnet-4-6", router: "static" },
    trace: { enabled: false, file: "", includeLlmPayload: false },
    permission: { timeoutS: 60 },
    compaction: {
      autoThreshold: 0,
      toolResultLimit: 8000,
      toolResultKeep: 4000,
    },
    mcp: { servers: [] },
    ...overrides,
  };
}

function parseEvents(content: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of content.trim().split("\n")) {
    if (!line) continue;
    const parsed: unknown = JSON.parse(line);
    if (isRecord(parsed)) {
      events.push(parsed);
    }
  }
  return events;
}

// Mock LLM provider that simulates a two-step agent interaction:
// Step 1: LLM requests to read_file("sample.txt")
// Step 2: LLM reports the magic number found in the file
function mockReadFileProvider(): LLMProvider {
  let callCount = 0;
  return {
    async chat(
      _messages: unknown[],
      _toolSchemas: unknown[],
      bus: EventBus,
      runId: string,
      _options?: { step?: number; system?: string | null },
    ): Promise<LlmResponse> {
      callCount++;
      const now = new Date().toISOString();

      await bus.publish({
        type: "llm.model_selected",
        run_id: runId,
        model: "claude-sonnet-4-6",
        strategy: "static",
        timestamp: now,
      });

      if (callCount === 1) {
        // First call: request to read the file
        await bus.publish({
          type: "llm.usage",
          run_id: runId,
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          context_percent: 0.05,
          timestamp: now,
        });

        return {
          stopReason: "tool_use",
          toolUses: [
            {
              id: "tu-1",
              name: "read_file",
              input: { path: "sample.txt" },
              type: "tool_use" as const,
              caller: { type: "direct" },
            },
          ],
          text: "",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextPercent: 0.05,
          },
          thinkingBlocks: [],
        };
      }

      // Second call: report the magic number
      await bus.publish({
        type: "llm.usage",
        run_id: runId,
        input_tokens: 200,
        output_tokens: 30,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 0,
        context_percent: 0.1,
        timestamp: now,
      });

      return {
        stopReason: "end_turn",
        toolUses: [],
        text: "The magic number mentioned in the file is 7391.",
        usage: {
          inputTokens: 200,
          outputTokens: 30,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 0,
          contextPercent: 0.1,
        },
        thinkingBlocks: [],
      };
    },
  };
}

describe("run e2e integration", () => {
  // Feature: Full end-to-end agent pipeline: mock LLM -> read_file tool -> success with events.jsonl
  // Design: Write a sample file, run agent with mock provider, verify events.jsonl has all key stages
  test("agent reads file and completes successfully", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swifty-e2e-"));
    const origDir = process.cwd();
    try {
      process.chdir(dir);

      // Create sample file for agent to read
      writeFileSync(
        path.join(dir, "sample.txt"),
        "# Test Document\n\nThe magic number mentioned in this file is 7391.\n",
        "utf-8",
      );

      const runsDir = path.join(dir, "runs");
      const config = makeConfig();
      const runner = new AgentRunner(config, {
        runsDir,
        provider: mockReadFileProvider(),
      });

      await runner.run(
        "Use the read_file tool to read the file 'sample.txt' and report the magic number it mentions.",
      );

      // events.jsonl must exist
      const runDirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(runsDir, d.name));

      expect(runDirs.length).toBeGreaterThan(0);

      const firstRunDir = runDirs[0];
      if (!firstRunDir) return;

      const eventsFile = path.join(firstRunDir, "events.jsonl");
      const content = readFileSync(eventsFile, "utf-8");
      const events = parseEvents(content);
      const types = events.map((e) => e["type"]);

      // Event sequence assertions
      expect(types[0]).toBe("run.started");
      expect(types[types.length - 1]).toBe("run.finished");
      expect(types).toContain("step.started");
      expect(types).toContain("tool.call_started");
      expect(types).toContain("tool.call_finished");
      expect(types).toContain("llm.usage");

      // Run completed successfully
      const finished = events[events.length - 1];
      expect(finished["status"]).toBe("success");

      // read_file was actually invoked
      const toolStarts = events.filter(
        (e) => e["type"] === "tool.call_started",
      );
      expect(toolStarts.some((e) => e["tool_name"] === "read_file")).toBe(true);

      // run_id is consistent across the event stream
      const runId = events[0]?.["run_id"];
      expect(events.every((e) => e["run_id"] === runId)).toBe(true);

      // LLM cache stats are present
      const usageEvents = events.filter((e) => e["type"] === "llm.usage");
      expect(usageEvents.length).toBeGreaterThanOrEqual(1);
      for (const ue of usageEvents) {
        expect(ue).toHaveProperty("input_tokens");
        expect(ue).toHaveProperty("output_tokens");
        expect(ue).toHaveProperty("cache_read_input_tokens");
      }
    } finally {
      process.chdir(origDir);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
