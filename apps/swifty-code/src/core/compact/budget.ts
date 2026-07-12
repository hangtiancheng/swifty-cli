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
