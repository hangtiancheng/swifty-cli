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

import { randomBytes } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  statSync,
  existsSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import z, { parse, safeParse } from "zod";

import { loadImageRef, saveSessionImages } from "../images/store.js";
import type { ImageAttachment } from "../images/types.js";
import { createChildLogger } from "../logger/index.js";

// Persistent session lines. Ordinary messages have an empty `type`, while compaction boundary records
// have the type COMPACT_BOUNDARY. Their `content` is the JSON-serialized CompactBoundaryPayload
// (containing a summary and the retained recent tail messages).
// Inlining the retained tail directly into the boundary record avoids "physical location" issues:
// during restoration, reading the boundary is sufficient to reconstruct
// [summary] + retained messages + messages appended after the boundary, without needing to search
// for the retained messages in the area preceding the boundary.
export const COMPACT_BOUNDARY = "compact_boundary";

/** Session expiry days. Session files older than this will be automatically cleaned up. */
const SESSION_EXPIRY_DAYS = 30;

// Tool block fields on disk always use snake_case; the in-memory conversation layer still uses camelCase.
// The conversion between the two is consolidated in boundary functions in this file (toolUsesToRecords / toRestored, etc.).

/** Persisted form of a tool invocation. Stores a provider-agnostic internal representation rather than
 *  any vendor-specific wire format, so sessions can be restored even after switching providers. */

const ToolUseRecordSchema = z.object({
  tool_use_id: z.string(),
  tool_name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
export type ToolUseRecord = z.infer<typeof ToolUseRecordSchema>;

/** Persisted reference to an image binary stored under sessions/<id>/images/.
 *  The base64 payload never lands in the JSONL itself. */
const ImageRefRecordSchema = z.object({
  path: z.string(),
  media_type: z.string(),
  source_path: z.string().optional(),
});
export type ImageRefRecord = z.infer<typeof ImageRefRecordSchema>;

/** Persisted form of a tool result, paired with a ToolUseRecord via tool_use_id. */
const ToolResultRecordSchema = z.object({
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean().optional(),
  images: z.array(ImageRefRecordSchema).optional(),
});

export type ToolResultRecord = z.infer<typeof ToolResultRecordSchema>;

const SessionMessageSchema = z.object({
  role: z.string(),
  content: z.string().default(""),
  timestamp: z.number(),
  type: z.string().optional(),
  tool_uses: z.array(ToolUseRecordSchema).optional(),
  tool_results: z.array(ToolResultRecordSchema).optional(),
  images: z.array(ImageRefRecordSchema).optional(),
});

export type SessionMessage = z.infer<typeof SessionMessageSchema>;

// A recent message preserved verbatim when compaction occurs. Like SessionMessage, it carries tool blocks
// so that the tool call chain remains intact when the session is restored after compaction.
const KeptMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  tool_uses: z.array(ToolUseRecordSchema).optional(),
  tool_results: z.array(ToolResultRecordSchema).optional(),
  images: z.array(ImageRefRecordSchema).optional(),
});

export type KeptMessage = z.infer<typeof KeptMessageSchema>;

/** Conversation-layer tool blocks (camelCase) → persisted records (snake_case); empty values are omitted. */
export function toolUsesToRecords(
  toolUses?: { toolUseId: string; toolName: string; arguments?: Record<string, unknown> }[],
): ToolUseRecord[] {
  return (toolUses ?? []).map((tu) => ({
    tool_use_id: tu.toolUseId,
    tool_name: tu.toolName,
    ...(tu.arguments && Object.keys(tu.arguments).length ? { arguments: tu.arguments } : {}),
  }));
}

export function toolResultsToRecords(
  toolResults?: {
    toolUseId: string;
    content: string;
    isError?: boolean;
    images?: ImageAttachment[] | undefined;
  }[],
  imageCtx?: { workDir: string; sessionId: string },
): ToolResultRecord[] {
  return (toolResults ?? []).map((tr) => ({
    tool_use_id: tr.toolUseId,
    content: tr.content,
    ...(tr.isError ? { is_error: true } : {}),
    ...(imageCtx && tr.images?.length
      ? { images: saveSessionImages(imageCtx.workDir, imageCtx.sessionId, tr.images) }
      : {}),
  }));
}

// Restore ImageAttachments from persisted refs. Missing/unreadable binaries
// are dropped; a human-readable note reports how many were lost so the model
// isn't silently confused by a dangling mention.
function restoreImageRefs(refs?: ImageRefRecord[]): {
  images: ImageAttachment[];
  note: string;
} {
  if (!refs?.length) {
    return { images: [], note: "" };
  }
  const images: ImageAttachment[] = [];
  for (const ref of refs) {
    const img = loadImageRef(ref);
    if (img) {
      images.push(img);
    }
  }
  const lost = refs.length - images.length;
  return {
    images,
    note:
      lost > 0 ? `\n[note: ${String(lost)} image(s) from this message could not be restored]` : "",
  };
}

const CompactBoundaryPayloadSchema = z.object({
  summary: z.string(),
  keep: z.array(KeptMessageSchema),
});

// Structured payload serialized into a compact_boundary record's `content`.
export type CompactBoundaryPayload = z.infer<typeof CompactBoundaryPayloadSchema>;

export interface SessionInfo {
  id: string;
  firstMessage: string;
  messageCount: number;
  size: number;
  modTime: Date;
}

const log = createChildLogger({ module: "session" });

function sessionsDir(workDir: string): string {
  return join(workDir, ".larky", "sessions");
}

export function getSessionFilePath(workDir: string, sessionId: string): string {
  return join(sessionsDir(workDir), sessionId + ".jsonl");
}

// Inverse of getSessionFilePath. Returns null when the path doesn't match the
// <workDir>/.larky/sessions/<id>.jsonl layout.
export function sessionCtxFromFilePath(
  filePath: string,
): { workDir: string; sessionId: string } | null {
  const base = basename(filePath);
  if (!base.endsWith(".jsonl")) {
    return null;
  }
  const dir = dirname(filePath);
  const parent = dirname(dir);
  if (basename(dir) !== "sessions" || basename(parent) !== ".larky") {
    return null;
  }
  return { workDir: dirname(parent), sessionId: base.slice(0, -".jsonl".length) };
}

export function newSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex");
  return `${ts}-${rand}`;
}

export function saveMessage(workDir: string, sessionId: string, msg: SessionMessage): void {
  const dir = sessionsDir(workDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.jsonl`);
  const line = JSON.stringify(msg) + "\n";
  writeFileSync(filePath, line, { flag: /* append */ "a", encoding: "utf-8" });
}

// Append a compaction boundary to the session. The summary and the verbatim
// kept tail are inlined into one COMPACT_BOUNDARY record. This is append-only:
// the pre-boundary original messages stay in the file (they just won't be
// replayed on resume — see rebuildFromSession).
export function saveCompactBoundary(
  workDir: string,
  sessionId: string,
  payload: CompactBoundaryPayload,
): void {
  saveMessage(workDir, sessionId, {
    role: "system",
    content: JSON.stringify(payload),
    timestamp: Math.floor(Date.now() / 1000),
    type: COMPACT_BOUNDARY,
  });
}

export function loadSession(workDir: string, sessionId: string): SessionMessage[] {
  const filePath = join(sessionsDir(workDir), `${sessionId}.jsonl`);
  if (!existsSync(filePath)) {
    return [];
  }

  const out: SessionMessage[] = [];
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const message: unknown = JSON.parse(line);
      const { success, data, error } = safeParse(SessionMessageSchema, message);
      // Boundary records carry their text payload in `content`, so keep them
      // (they pass the non-empty content check). Skip malformed or
      // empty-content ordinary messages rather than crashing the load.
      if (success) {
        const isEmpty =
          !data.content && // empty content
          !(data.tool_uses?.length ?? 0) && // empty tool uses
          !(data.tool_results?.length ?? 0) && // empty tool results
          !(data.images?.length ?? 0); // empty images
        if (!isEmpty) {
          out.push(data);
        }
      } else {
        log.error({ err: error }, "session operation failed");
      }
    } catch (err) {
      log.error({ err }, "session operation failed");
      // skip malformed line
    }
  }
  return out;
}

// A message ready to replay on resume. Boundary records expand into the summary
// (as a synthetic user message) followed by their inlined kept tail; ordinary
// records map 1:1. This is the compacted-state reconstruction.
export interface RestoredMessage {
  role: "user" | "assistant";
  content: string;
  // In-memory form uses camelCase, consistent with the conversation layer; converted from snake_case disk records
  toolUses?: { toolUseId: string; toolName: string; arguments?: Record<string, unknown> }[];
  toolResults?: {
    toolUseId: string;
    content: string;
    isError?: boolean;
    images?: ImageAttachment[];
  }[];
  images?: ImageAttachment[];
}

/** Persisted records (snake_case) → in-memory tool blocks (camelCase), used to restore the call chain on session resume. */
function recordsToCamelUses(recs?: ToolUseRecord[]) {
  return recs?.map((tu) => ({
    toolUseId: tu.tool_use_id,
    toolName: tu.tool_name,
    arguments: tu.arguments,
  }));
}

function recordsToCamelResults(recs?: ToolResultRecord[]) {
  return recs?.map((tr) => {
    const restored = restoreImageRefs(tr.images);
    return {
      toolUseId: tr.tool_use_id,
      content: tr.content + restored.note,
      isError: tr.is_error,
      ...(restored.images.length ? { images: restored.images } : {}),
    };
  });
}

// Rebuild the conversation to replay on resume, honoring compaction boundaries.
//
//   - If the session contains at least one compact_boundary, take the LAST one
//     and rebuild: [summary as a user message] + its inlined keep tail +
//     every ordinary message appended AFTER that boundary. The original
//     messages before the boundary stay in the file but are NOT replayed —
//     that's the whole point of compaction surviving a resume.
//   - If there is no boundary (old sessions, or never compacted), replay every
//     ordinary message verbatim. Fully backward-compatible.
export function rebuildFromSession(saved: SessionMessage[]): RestoredMessage[] {
  // Find the last boundary record.
  let lastBoundary = -1;
  for (let i = saved.length - 1; i >= 0; i--) {
    if (saved[i].type === COMPACT_BOUNDARY) {
      lastBoundary = i;
      break;
    }
  }

  const out: RestoredMessage[] = [];

  if (lastBoundary >= 0) {
    // Compacted state: summary + inlined keep, then post-boundary appends.
    let payload: CompactBoundaryPayload | null = null;
    try {
      const payload_: unknown = JSON.parse(saved[lastBoundary].content);
      payload = parse(CompactBoundaryPayloadSchema, payload_);
    } catch {
      payload = null;
    }
    if (payload) {
      // The summary stands in for everything before the boundary, replayed as a
      // single user message (mirrors how doCompact rebuilds the live transcript).
      let resumeSummary =
        "This session continues from a previous conversation, which has been compressed due to context limitations. Here is a summary of the earlier messages:\n\n" +
        payload.summary;
      if (payload.keep.length > 0) {
        resumeSummary += "\n\nRecent messages have been preserved verbatim.";
      }
      out.push({ role: "user", content: resumeSummary });
      for (const k of payload.keep) {
        if (
          (k.role !== "user" && k.role !== "assistant") ||
          (!k.content && // empty content
            !(k.tool_uses?.length ?? 0) && // empty tool uses
            !(k.tool_results?.length ?? 0) && // empty tool results
            !(k.images?.length ?? 0)) // empty images
        ) {
          continue;
        }

        const restoredImages = restoreImageRefs(k.images);
        out.push({
          role: k.role,
          content: k.content + restoredImages.note,
          toolUses: recordsToCamelUses(k.tool_uses),
          toolResults: recordsToCamelResults(k.tool_results),
          ...(restoredImages.images.length ? { images: restoredImages.images } : {}),
        });
      }
    }
    // Replay ordinary messages appended after the boundary (continuation turns).
    for (let i = lastBoundary + 1; i < saved.length; i++) {
      const m = saved[i];
      if (m.type === COMPACT_BOUNDARY) {
        continue;
      } // defensive; last() already found
      const restored = toRestored(m);
      if (restored) {
        out.push(restored);
      }
    }
    return out;
  }

  // No boundary → full replay (backward compatible).
  for (const m of saved) {
    const restored = toRestored(m);
    if (restored) {
      out.push(restored);
    }
  }
  return out;
}

// Restore a single persisted record into a replayable message, including its tool blocks.
// Messages containing only tool results have no text but must still be restored, otherwise the call chain breaks.
function toRestored(m: SessionMessage): RestoredMessage | null {
  if (m.role !== "user" && m.role !== "assistant") {
    return null;
  }
  if (
    !m.content &&
    !(m.tool_uses?.length ?? 0) && // empty tool uses
    !(m.tool_results?.length ?? 0) && // empty tool results
    !(m.images?.length ?? 0) // empty images
  ) {
    return null;
  }
  const restored = restoreImageRefs(m.images);
  return {
    role: m.role,
    content: m.content + restored.note,
    toolUses: recordsToCamelUses(m.tool_uses),
    toolResults: recordsToCamelResults(m.tool_results),
    ...(restored.images.length ? { images: restored.images } : {}),
  };
}

export function listSessions(workDir: string): SessionInfo[] {
  const dir = sessionsDir(workDir);
  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const sessions: SessionInfo[] = [];

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    const id = file.replace(".jsonl", "");

    let firstMessage = "";
    let messageCount = 0;
    try {
      for (const line of readFileSync(filePath, "utf-8").split("\n")) {
        if (!line.trim()) {
          continue;
        }
        let m: SessionMessage;
        try {
          const raw: unknown = JSON.parse(line);
          m = parse(SessionMessageSchema, raw);
        } catch (err) {
          log.error({ err }, "session operation failed");
          continue;
        }
        messageCount++;
        // Label the session by its first user message (untruncated role match).
        if (!firstMessage && m.role === "user" && m.content) {
          firstMessage = m.content.slice(0, 100);
        }
      }
    } catch (err2) {
      log.error({ err: err2 }, "session operation failed");
      continue;
    }

    sessions.push({
      id,
      firstMessage,
      messageCount,
      size: stat.size,
      modTime: stat.mtime,
    });
  }

  sessions.sort((a, b) => b.modTime.getTime() - a.modTime.getTime());
  return sessions;
}

/**
 * Cleans up expired sessions: deletes .jsonl files whose last modified time exceeds SESSION_EXPIRY_DAYS.
 * Called during listSessions or on startup to prevent the session directory from growing indefinitely.
 * Silently skips failures (best-effort).
 */
export function cleanExpiredSessions(workDir: string): number {
  const dir = sessionsDir(workDir);
  if (!existsSync(dir)) {
    return 0;
  }

  const now = Date.now();
  const expiryMs = SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch (err) {
    log.error({ err }, "session operation failed");
    return 0;
  }

  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > expiryMs) {
        unlinkSync(filePath);
        // Clean up the session's spill/images subdirectory tree. Must be
        // recursive: it contains tool-results/ and images/ subdirectories.
        const id = file.replace(".jsonl", "");
        const sessionSubdir = join(workDir, ".larky", "sessions", id);
        try {
          rmSync(sessionSubdir, { recursive: true, force: true });
        } catch {
          /** noop */
        }
        removed++;
      }
    } catch (err) {
      log.error({ err }, "session operation failed");
      // Silently skip if deletion fails
    }
  }
  return removed;
}
