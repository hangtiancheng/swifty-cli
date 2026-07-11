import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "tool-result" });

import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Message, ToolUseBlock } from "../conversation/conversation.js";
import { isObject } from "../utils/index.js";

const SINGLE_RESULT_LIMIT = 50000;
const MESSAGE_AGGREGATE_LIMIT = 200000;

const PERSISTED_TAG_PREFIX = "[Result of ";

function spillDir(workDir: string, sessionId: string): string {
  const id = sessionId || "default";
  return join(workDir, ".swifty", "sessions", id, "tool_results");
}

function writeSpill(
  workDir: string,
  sessionId: string,
  toolUseId: string,
  content: string,
): string {
  const dir = spillDir(workDir, sessionId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, toolUseId);
  try {
    writeFileSync(path, content, { encoding: "utf-8", flag: "wx" });
  } catch (err: unknown) {
    log.error({ err }, "tool-result operation failed");
    if (isObject(err) && "code" in err && err.code !== "EEXIST") {
      throw err;
    }
  }
  return path;
}
const PREVIEW_CHARS = 2000;

function buildSpillPreview(content: string, spillPath: string): string {
  const sizeKB = Math.floor(content.length / 1024);
  const preview = content.slice(0, PREVIEW_CHARS);
  const hasMore = content.length > PREVIEW_CHARS;
  let msg = `${PERSISTED_TAG_PREFIX}tool call]\n<persisted-output>\n`;
  msg += `Output too large (${String(sizeKB)}KB). Full content saved to:\n${spillPath}\n\n`;
  msg += `Preview (first 2KB):\n${preview}`;
  if (hasMore) {
    msg += "\n...";
  }
  msg += "\n</persisted-output>";
  return msg;
}

// Check whether a tool result has already been replaced (detected by prefix tag)
function isAlreadyReplaced(content: string): boolean {
  return content.startsWith(PERSISTED_TAG_PREFIX);
}

function isSpillReadback(
  toolUseId: string,
  toolUseIndex: Map<string, ToolUseBlock>,
  absSpillDir: string,
): boolean {
  const tu = toolUseIndex.get(toolUseId);
  if (!tu || tu.toolName !== "ReadFile" || !absSpillDir) return false;
  const raw = tu.arguments?.file_path;
  if (typeof raw !== "string" || !raw) return false;
  return resolve(raw).startsWith(absSpillDir);
}

function buildToolUseIndex(messages: Message[]): Map<string, ToolUseBlock> {
  const idx = new Map<string, ToolUseBlock>();
  for (const m of messages) {
    if (m.toolUses) {
      for (const tu of m.toolUses) idx.set(tu.toolUseId, tu);
    }
  }
  return idx;
}

/**
 * applyBudget modifies messages in-place for oversized toolResult.content:
 * - Pass 1: Single results exceeding SINGLE_RESULT_LIMIT are spilled to disk.
 * - Pass 2: Message-aggregate exceeding MESSAGE_AGGREGATE_LIMIT spills the largest results.
 * Already-replaced results (with persistedTagPrefix prefix) are skipped for idempotence.
 */
export function applyBudget(messages: Message[], workDir: string, sessionId: string): void {
  // Walk from the tail to find messages that need processing. Older messages have
  // already had their tool_results replaced in previous rounds; stop once we hit
  // a message whose results are all previews.
  const toProcess: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const trs = messages[i].toolResults;
    if (!trs || trs.length === 0) continue;
    const hasFresh = trs.some((tr) => !isAlreadyReplaced(tr.content));
    if (!hasFresh) break;
    toProcess.push(i);
  }
  if (toProcess.length === 0) return;

  const absSpillDir = resolve(spillDir(workDir, sessionId));
  const toolUseIndex = buildToolUseIndex(messages);

  for (const idx of toProcess) {
    const msg = messages[idx];
    if (!msg.toolResults || msg.toolResults.length === 0) continue;

    // Pass 1: Single result exceeds limit -> spill to disk
    for (const tr of msg.toolResults) {
      // Skip already-replaced results for idempotence
      if (isAlreadyReplaced(tr.content)) continue;

      if (tr.content.length > SINGLE_RESULT_LIMIT) {
        if (isSpillReadback(tr.toolUseId, toolUseIndex, absSpillDir)) continue;
        const spillPath = writeSpill(workDir, sessionId, tr.toolUseId, tr.content);
        tr.content = buildSpillPreview(tr.content, spillPath);
      }
    }

    // Pass 2: Message-aggregate over limit -> spill the largest result
    let totalLen = msg.toolResults.reduce((sum, r) => sum + r.content.length, 0);
    if (totalLen > MESSAGE_AGGREGATE_LIMIT) {
      // Sort by content length descending; spill the largest first
      const sorted = [...msg.toolResults].sort((a, b) => b.content.length - a.content.length);
      for (const r of sorted) {
        if (totalLen <= MESSAGE_AGGREGATE_LIMIT) break;
        if (isAlreadyReplaced(r.content)) continue;
        if (isSpillReadback(r.toolUseId, toolUseIndex, absSpillDir)) continue;
        if (r.content.length > PREVIEW_CHARS) {
          const before = r.content;
          const spillPath = writeSpill(workDir, sessionId, r.toolUseId, before);
          const replacement = buildSpillPreview(before, spillPath);
          totalLen = totalLen - before.length + replacement.length;
          r.content = replacement;
        }
      }
    }
  }
}
