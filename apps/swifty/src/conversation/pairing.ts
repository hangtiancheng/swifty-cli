import type { Message, ToolResultBlock } from "./conversation.js";

// Anthropic requires every tool_use to have a matching tool_result; a single missing
// pairing causes the entire request to be rejected. Unpaired entries can creep into
// the conversation history in several ways: the user interrupts mid-tool-execution,
// a session is restored from disk after the process exits, or concurrent writes
// interleave. Here we reconcile the pairing uniformly before sending the request, so
// individual frontends don't each have to reimplement it.

/** Used to fill in tool calls that have no result. The tool may never have started,
 *  or it may have been interrupted partway through, so the wording must not assert
 *  that it produced no side effects. */
export const INTERRUPTED_TOOL_RESULT =
  "Tool execution was interrupted. The tool may or may not have completed; verify before relying on its effects.";

/** Used for tool calls the user explicitly declined to authorize. In this case we can
 *  assert that nothing was changed, and we must state this clearly; otherwise the
 *  model will assume the modification took effect and proceed accordingly. */
export const REJECTED_TOOL_RESULT =
  "The user rejected this tool use. Nothing was changed (for file edits, the new content was NOT written).";

/**
 * Returns a copy of the messages with the pairing relationships repaired; the input
 * is not modified.
 *
 * It does two things: appends a tool_result marked as an error (immediately after)
 * for any tool_use that has no result, and drops orphan tool_results whose matching
 * tool_use cannot be found. The patched content is not written back to the
 * conversation history: the history should faithfully record what actually happened,
 * while the patching exists only to make this particular request valid.
 */
export function ensureToolPairing(messages: Message[]): Message[] {
  const resolved = new Set<string>();
  const issued = new Set<string>();
  for (const m of messages) {
    for (const tr of m.toolResults ?? []) {
      resolved.add(tr.toolUseId);
    }
    for (const tu of m.toolUses ?? []) {
      issued.add(tu.toolUseId);
    }
  }

  const out: Message[] = [];
  for (const m of messages) {
    let current = m;
    if ((m.toolResults?.length ?? 0) > 0) {
      const kept = (m.toolResults ?? []).filter((tr) => issued.has(tr.toolUseId));
      if (kept.length === 0 && !m.content && !(m.toolUses?.length ?? 0)) {
        continue; // The message is now an empty shell; drop it to preserve role alternation
      }
      current = { ...m, toolResults: kept };
    }
    out.push(current);

    const missing: ToolResultBlock[] = [];
    for (const tu of m.toolUses ?? []) {
      if (resolved.has(tu.toolUseId)) {
        continue;
      }
      missing.push({
        toolUseId: tu.toolUseId,
        content: INTERRUPTED_TOOL_RESULT,
        isError: true,
      });
      resolved.add(tu.toolUseId);
    }
    if (missing.length > 0) {
      out.push({ role: "user", content: "", toolResults: missing });
    }
  }
  return out;
}
