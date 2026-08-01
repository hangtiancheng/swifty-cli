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

import {
  readFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, basename } from "node:path";

import yaml from "js-yaml";
import z, { parse } from "zod";

import { ConversationManager } from "../conversation/conversation.js";
import type { LLMClient } from "../llm/client.js";
import { createChildLogger } from "../logger/index.js";

import { memoryAge, memoryFreshnessText } from "./memory-age.js";

const log = createChildLogger({ module: "memory" });

/** Caps for MEMORY.md index content: 200 lines or 25KB, whichever is hit first. */
const MAX_ENTRYPOINT_LINES = 200;
const MAX_ENTRYPOINT_BYTES = 25_000;
const MEMORY_INDEX_NAME = "MEMORY.md";

/**
 * Truncates index content to fit within the byte limit.
 *
 * Preferably cuts at the last newline before the limit so that only complete entries are retained.
 * In UTF-8, ASCII bytes never appear inside multi-byte sequences, so scanning for a newline at the
 * byte level is safe. When no newline exists in the entire segment, we hard-cut at the byte limit
 * and then back up to a character boundary; otherwise a multi-byte character split in half would
 * decode to a replacement character.
 */
function capEntrypoint(content: string): string {
  const buf = Buffer.from(content, "utf-8");
  if (buf.length <= MAX_ENTRYPOINT_BYTES) {
    return content;
  }

  const nl = buf.lastIndexOf(0x0a, MAX_ENTRYPOINT_BYTES - 1);
  if (nl > 0) {
    return buf.subarray(0, nl).toString("utf-8");
  }

  let end = MAX_ENTRYPOINT_BYTES;
  // UTF-8 continuation bytes always have the top two bits set to 10; skip backward past them to land on a character boundary
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end--;
  }
  return buf.subarray(0, end).toString("utf-8");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const SelectedMemoriesSchema = z.object({
  selected_memories: z.array(z.string()),
});

type SelectedMemories = z.infer<typeof SelectedMemoriesSchema>;

export interface MemoryFile {
  path: string;
  name: string;
  description: string;
  type: string;
  content: string;
}

/** Header metadata from a scanned memory file, used by findRelevantMemories. */
export interface MemoryHeader {
  filename: string; // path relative to the memory dir
  filePath: string; // absolute path
  scope: string; // "user" or "project"
  mtimeMs: number; // modification time, ms since epoch
  description: string;
  type: string;
}

/** One memory selected for surfacing into the main conversation. */
export interface RelevantMemory {
  path: string;
  mtimeMs: number;
}

/** The system prompt for the selector agent. */
const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to Larky as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to Larky as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (Larky is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.

Respond with valid JSON only, no markdown, in this exact shape: {"selected_memories": ["filename1.md", "filename2.md"]}`;

export class MemoryManager {
  private userDir: string;
  private projectDir: string;

  constructor(workDir: string) {
    this.userDir = join(homedir(), ".larky", "memory");
    this.projectDir = join(workDir, ".larky", "memory");
  }

  loadAll(): MemoryFile[] {
    const memories: MemoryFile[] = [];
    for (const dir of [this.userDir, this.projectDir]) {
      if (!existsSync(dir)) {
        continue;
      }
      const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== MEMORY_INDEX_NAME);
      for (const file of files) {
        const fullPath = join(dir, file);
        try {
          const raw = readFileSync(fullPath, "utf-8");
          const parsed = parseFrontmatter(raw);
          if (parsed) {
            memories.push({
              path: fullPath,
              name: parsed.name ?? file.replace(".md", ""),
              description: parsed.description ?? "",
              type: parsed.type ?? "reference",
              content: parsed.body,
            });
          }
        } catch (err) {
          log.error({ err }, "memory operation failed");
          continue;
        }
      }
    }
    this.rebuildIndex();
    return memories;
  }

  getMemories(): MemoryFile[] {
    return this.loadAll();
  }

  /**
   * Builds the memory index injected into the system prompt.
   *
   * This content is re-sent to the model on every conversation turn, so each additional index line
   * is a recurring cost. We therefore enforce both a line-count and a byte-size cap at the output
   * boundary. When either limit is exceeded, a warning is appended at the end so the model knows
   * the index it received is incomplete; otherwise it would assume a memory does not exist and
   * create a duplicate entry.
   */
  buildSystemReminder(): string {
    const memories = this.loadAll();
    if (memories.length === 0) {
      return "";
    }

    const lines = memories.map((m) => `- [${m.name}] (${m.type}): ${m.description}`);

    const lineCount = lines.length;
    const joined = lines.join("\n");
    const byteCount = Buffer.byteLength(joined, "utf-8");
    const overLines = lineCount > MAX_ENTRYPOINT_LINES;
    const overBytes = byteCount > MAX_ENTRYPOINT_BYTES;

    if (!overLines && !overBytes) {
      return `Active memories:\n${joined}`;
    }

    const body = capEntrypoint(lines.slice(0, MAX_ENTRYPOINT_LINES).join("\n"));

    let reason: string;
    if (overBytes && !overLines) {
      reason = `${formatFileSize(byteCount)} (limit: ${formatFileSize(
        MAX_ENTRYPOINT_BYTES,
      )}) — index entries are too long`;
    } else if (overLines && !overBytes) {
      reason = `${String(lineCount)} lines (limit: ${String(MAX_ENTRYPOINT_LINES)})`;
    } else {
      reason = `${String(lineCount)} lines and ${formatFileSize(byteCount)}`;
    }

    return (
      `Active memories:\n${body}\n\n` +
      `> WARNING: ${MEMORY_INDEX_NAME} is ${reason}. Only part of it was loaded. ` +
      `Keep index entries to one line under ~200 chars; move detail into topic files.`
    );
  }

  clear(): void {
    for (const dir of [this.userDir, this.projectDir]) {
      if (!existsSync(dir)) {
        continue;
      }
      const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        try {
          unlinkSync(join(dir, file));
        } catch (err) {
          log.error({ err }, "memory operation failed");
          continue;
        }
      }
    }
  }

  // ── Feature 1: MEMORY.md index generation ──────────────────────────

  /**
   * Scans both userDir and projectDir for .md files (excluding MEMORY.md),
   * parses each file's frontmatter for name + description, and writes a
   * MEMORY.md index in the projectDir. One line per memory, sorted
   * alphabetically by name, truncated at MAX_ENTRYPOINT_LINES / MAX_ENTRYPOINT_BYTES.
   */
  rebuildIndex(): void {
    interface Entry {
      name: string;
      relPath: string;
      description: string;
    }
    const entries: Entry[] = [];

    for (const dir of [this.userDir, this.projectDir]) {
      if (!existsSync(dir)) {
        continue;
      }
      const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== MEMORY_INDEX_NAME);
      try {
        for (const file of files) {
          const fullPath = join(dir, file);
          try {
            const raw = readFileSync(fullPath, "utf-8");
            const parsed = parseFrontmatter(raw);
            if (!parsed) {
              continue;
            }

            const name = parsed.name ?? file.replace(".md", "");
            const description = parsed.description ?? "";
            // Relative path from projectDir so the link works from MEMORY.md
            const relativePath = relative(this.projectDir, fullPath) || file;

            entries.push({ name, relPath: relativePath, description });
          } catch (err) {
            log.error({ err }, "memory operation failed");
            continue;
          }
        }
      } catch (err2) {
        log.error({ err: err2 }, "memory operation failed");
        continue;
      }
    }

    // Sort alphabetically by name (case-insensitive)
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    // Build index lines
    const lines: string[] = [];
    for (const e of entries) {
      if (e.description) {
        lines.push(`- [${e.name}](${e.relPath}) — ${e.description}`);
      } else {
        lines.push(`- [${e.name}](${e.relPath})`);
      }
    }

    const content = capEntrypoint(lines.slice(0, MAX_ENTRYPOINT_LINES).join("\n"));

    // Write MEMORY.md into projectDir, ensuring the dir exists
    mkdirSync(this.projectDir, { recursive: true });
    writeFileSync(join(this.projectDir, MEMORY_INDEX_NAME), content + "\n", "utf-8");
  }

  // ── Feature 2: findRelevantMemories ────────────────────────────────

  /**
   * Scans all memory headers from both dirs, asks the LLM to select the
   * top 5 most relevant ones for the query, and returns the full content
   * of those files. Best-effort: selector failures return an empty array.
   */
  async findRelevantMemories(
    query: string,
    client: LLMClient,
    recentTools: string[] = [],
    alreadySurfaced = new Set<string>(),
  ): Promise<RelevantMemory[]> {
    // 1. Scan both dirs for memory headers
    const allHeaders: MemoryHeader[] = [];
    for (const [dir, scope] of [
      [this.userDir, "user"],
      [this.projectDir, "project"],
    ] as const) {
      const headers = scanMemoryHeaders(dir, scope);
      allHeaders.push(...headers);
    }

    // Filter out already-surfaced files
    const candidates = allHeaders.filter((h) => !alreadySurfaced.has(h.filePath));
    if (candidates.length === 0) {
      return [];
    }

    // 2. Build the manifest and ask the LLM to select
    const manifest = formatMemoryManifest(candidates);
    let toolsSection = "";
    if (recentTools.length > 0) {
      toolsSection = "\n\nRecently used tools: " + recentTools.join(", ");
    }

    const userMessage = `Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}`;

    let rawResponse = "";
    try {
      const conversation = new ConversationManager();
      // The TS LLMClient binds system prompts at construction time, so we
      // inline the selector instructions as a user message (same pattern as
      // the MemoryExtractor).
      conversation.addUserMessage(SELECT_MEMORIES_SYSTEM_PROMPT + "\n\n" + userMessage);

      const stream = client.stream(conversation, []);
      for await (const event of stream) {
        if (event.type === "text_delta") {
          rawResponse += event.text;
        }
      }
    } catch (err) {
      log.error({ err }, "memory operation failed");
      return [];
    }

    // 3. Parse the selector response
    const jsonStr = extractJSONObject(rawResponse);
    if (!jsonStr) {
      return [];
    }

    let parsed: SelectedMemories;
    try {
      const raw: unknown = JSON.parse(jsonStr);
      parsed = parse(SelectedMemoriesSchema, raw);
    } catch (err) {
      log.error({ err }, "memory operation failed");
      return [];
    }

    // Build lookup maps: by filePath and by filename (relative)
    const byKey = new Map<string, MemoryHeader>();
    for (const h of candidates) {
      byKey.set(h.filePath, h);
      if (!byKey.has(h.filename)) {
        byKey.set(h.filename, h);
      }
    }

    // 4. Resolve selected filenames to RelevantMemory objects
    const selected: RelevantMemory[] = [];
    for (const fn of parsed.selected_memories) {
      const h = byKey.get(fn);
      if (!h) {
        continue;
      }
      selected.push({ path: h.filePath, mtimeMs: h.mtimeMs });
    }

    return selected;
  }

  renderReminder(memories: RelevantMemory[]): string {
    if (memories.length === 0) {
      return "";
    }

    const parts: string[] = [
      "The following relevant memories from prior conversations may help:\n",
    ];
    for (const mem of memories) {
      let content: string;
      try {
        content = readFileSync(mem.path, "utf-8");
      } catch {
        continue;
      }
      const name = basename(mem.path);
      parts.push(`## Memory: ${name} (saved ${memoryAge(mem.mtimeMs)})\n`);
      const note = memoryFreshnessText(mem.mtimeMs);
      if (note) {
        parts.push(note + "\n");
      }
      parts.push(content + "\n\n---\n");
    }
    return parts.join("\n");
  }
}

/**
 * Scans a memory directory for .md files (excluding MEMORY.md), reads
 * their frontmatter, and returns headers sorted newest-first (capped at
 * MAX_ENTRYPOINT_LINES files).
 */
function scanMemoryHeaders(dir: string, scope: string): MemoryHeader[] {
  if (!existsSync(dir)) {
    return [];
  }

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== MEMORY_INDEX_NAME);
  } catch (err) {
    log.error({ err }, "memory operation failed");
    return [];
  }

  const headers: MemoryHeader[] = [];
  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) {
        continue;
      }

      const raw = readFileSync(fullPath, "utf-8");
      const parsed = parseFrontmatter(raw);
      if (!parsed) {
        continue;
      }

      headers.push({
        filename: file,
        filePath: fullPath,
        scope,
        mtimeMs: stat.mtimeMs,
        description: parsed.description ?? "",
        type: parsed.type ?? "",
      });
    } catch (err) {
      log.error({ err }, "memory operation failed");
      continue;
    }
  }

  // Sort newest-first
  headers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (headers.length > MAX_ENTRYPOINT_LINES) {
    headers.length = MAX_ENTRYPOINT_LINES;
  }
  return headers;
}

/**
 * Formats memory headers as a text manifest for the selector prompt.
 * One line per file: - [scope] [type] filepath (timestamp): description
 */
function formatMemoryManifest(memories: MemoryHeader[]): string {
  if (memories.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const m of memories) {
    const scope = m.scope ? `[${m.scope}-scope] ` : "";
    const tag = m.type ? `[${m.type}] ` : "";
    const ts = new Date(m.mtimeMs).toISOString();
    const path = m.filePath || m.filename;
    if (m.description) {
      lines.push(`- ${scope}${tag}${path} (${ts}): ${m.description}`);
    } else {
      lines.push(`- ${scope}${tag}${path} (${ts})`);
    }
  }
  return lines.join("\n");
}

/**
 * Extracts the first {...} JSON object from raw text, tolerating markdown
 * fences or prose around it.
 */
function extractJSONObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }
  const start = trimmed.indexOf("{");
  if (start < 0) {
    return "";
  }
  const end = trimmed.lastIndexOf("}");
  if (end < start) {
    return "";
  }
  return trimmed.slice(start, end + 1);
}

const FrontmatterSchema = z.looseObject({
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  metadata: z
    .looseObject({
      type: z.string().optional(),
    })
    .optional(),
});

interface ParsedFrontmatter {
  name?: string | undefined;
  description?: string | undefined;
  type?: string | undefined;
  body: string;
}

/**
 * Parse frontmatter
 * ---
 * name: larky-docs
 * description: The description of larky-docs
 * ---
 * Parses frontmatter and extracts name/description/type.
 * The type field is read from the top level first; the nested metadata.type form is also accepted.
 */
function parseFrontmatter(content: string): ParsedFrontmatter | null {
  if (!content.startsWith("---")) {
    return { body: content };
  }

  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) {
    return { body: content };
  }

  const frontmatter = content.slice(3, endIdx).trim();
  const body = content.slice(endIdx + 3).trim();

  try {
    const raw: unknown = yaml.load(frontmatter);
    const parsed = parse(FrontmatterSchema, raw);
    // Prefer top-level type, falling back to metadata.type (legacy TS format)
    const topType = parsed.type;
    const nestedType = parsed.metadata?.type;
    return {
      name: parsed.name,
      description: parsed.description,
      type: topType ?? nestedType,
      body,
    };
  } catch (err) {
    log.error({ err }, "memory operation failed");
    return { body: content };
  }
}
