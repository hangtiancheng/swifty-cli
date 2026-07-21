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

// In-memory tool_result truncation to control message size sent to the LLM
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResultBlockParam } from "@anthropic-ai/sdk/resources";

const DEFAULT_LIMIT = 8000;
const DEFAULT_KEEP = 4000;

// Truncate a single tool_result block's text content
function truncateToolResultBlock(
  block: ToolResultBlockParam,
  limit: number,
  keep: number,
): ToolResultBlockParam {
  const content = block.content;
  if (typeof content !== "string") return block;
  if (content.length <= limit) return block;
  return {
    ...block,
    content: content.slice(0, keep) + `\n[truncated ${String(content.length - keep)} chars]`,
  };
}

// Truncate oversized tool_result content, keeping the first KEEP characters
export function truncateToolResults(
  messages: Anthropic.MessageParam[],
  limit = DEFAULT_LIMIT,
  keep = DEFAULT_KEEP,
): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    // Per Anthropic Messages API contract, tool_result blocks only appear in
    // user-role messages (assistant messages only carry text / thinking / tool_use).
    // Skipping non-user roles is therefore a correctness filter aligned with the
    // wire-format, not a redundant guard. Mirrors Python budget.py:17.
    if (msg.role !== "user") return msg;
    if (typeof msg.content === "string") return msg;

    const newContent = msg.content.map((block) => {
      if (block.type !== "tool_result") return block;
      return truncateToolResultBlock(block, limit, keep);
    });

    return { ...msg, content: newContent };
  });
}
