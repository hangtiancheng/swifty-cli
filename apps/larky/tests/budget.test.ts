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
import { truncateToolResults } from "../src/core/compact/budget.js";

describe("truncateToolResults", () => {
  // Feature: Verify short tool_result content is not truncated
  // Design: Pass message with content below limit, confirm it's unchanged
  test("short content not truncated", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "t1",
            content: "short content",
          },
        ],
      },
    ];
    const result = truncateToolResults(messages, 100, 50);
    const firstMsg = result[0];
    if (Array.isArray(firstMsg.content)) {
      const block = firstMsg.content[0];
      if (block.type === "tool_result") {
        expect(block.content).toBe("short content");
      }
    }
  });

  // Feature: Verify long tool_result content is truncated to keep length
  // Design: Pass message with content exceeding limit, confirm truncation marker and kept length
  test("long content truncated", () => {
    const longContent = "x".repeat(200);
    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "t1",
            content: longContent,
          },
        ],
      },
    ];
    const result = truncateToolResults(messages, 100, 50);
    const firstMsg = result[0];
    if (Array.isArray(firstMsg.content)) {
      const block = firstMsg.content[0];
      if (block.type === "tool_result" && typeof block.content === "string") {
        expect(block.content.length).toBeLessThan(200);
        // Marker matches old budget.py semantics: omitted char count + pointer to run events
        expect(block.content).toContain("[... 150 chars omitted. Full output in run events.]");
      }
    }
  });

  // Feature: Verify non-tool_result blocks are not affected
  // Design: Pass message with text block, confirm it's unchanged
  test("non-tool_result blocks unchanged", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "assistant text" }],
      },
    ];
    const result = truncateToolResults(messages, 100, 50);
    const firstMsg = result[0];
    if (Array.isArray(firstMsg.content)) {
      const block = firstMsg.content[0];
      if (block.type === "text") {
        expect(block.text).toBe("assistant text");
      }
    }
  });

  // Feature: Verify string content messages are not affected
  // Design: Pass message with string content, confirm it's unchanged
  test("string content messages unchanged", () => {
    const messages = [
      {
        role: "user" as const,
        content: "user message",
      },
    ];
    const result = truncateToolResults(messages, 100, 50);
    expect(result[0]?.content).toBe("user message");
  });
});
