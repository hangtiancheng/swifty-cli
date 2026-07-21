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

/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryExtractor } from "../src/memory/extractor.js";
import type { LLMClient } from "../src/llm/client.js";
import type { StreamEvent } from "../src/llm/events.js";

class MockClient implements LLMClient {
  constructor(private text: string) {}
  setSystemPrompt(_prompt: string): void {
    /** noop */
  }
  setMaxOutputTokens?(_maxTokens: number): void {
    /** noop */
  }
  async *stream(): AsyncGenerator<StreamEvent> {
    yield { type: "text_delta", text: this.text };
    yield {
      type: "stream_end",
      stopReason: "end_turn",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    };
  }
}

describe("MemoryExtractor", () => {
  it("parses memory blocks and routes project/reference memories to the project dir", async () => {
    // Only project-scoped types so the test writes into the temp workDir,
    // never the real home directory.
    const response = [
      "MEMORY_NAME: build-cmd",
      "MEMORY_TYPE: project",
      "MEMORY_DESC: how to build",
      "MEMORY_BODY: Run bun run build.",
      "---",
      "MEMORY_NAME: api-docs",
      "MEMORY_TYPE: reference",
      "MEMORY_DESC: api reference link",
      "MEMORY_BODY: See https://example.com/api",
      "---",
    ].join("\n");

    const workDir = mkdtempSync(join(tmpdir(), "swifty-mem-"));
    const saved = await new MemoryExtractor(new MockClient(response), workDir).extract(
      "conversation",
    );

    expect(saved.sort()).toEqual(["api-docs", "build-cmd"]);

    const memDir = join(workDir, ".swifty", "memory");
    expect(existsSync(join(memDir, "build-cmd.md"))).toBe(true);
    const file = readFileSync(join(memDir, "build-cmd.md"), "utf-8");
    expect(file).toContain("name: build-cmd");
    expect(file).toContain("type: project");
    expect(file).toContain("Run bun run build.");
  });

  it("returns nothing when the model says NONE", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "swifty-mem-"));
    const saved = await new MemoryExtractor(new MockClient("NONE"), workDir).extract(
      "conversation",
    );
    expect(saved).toEqual([]);
  });
});
