import {
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { LLMClient } from "../llm/client.js";
import { ConversationManager } from "../conversation/conversation.js";
import { ToolRegistry } from "../tools/registry.js";
import { ReadFileTool } from "../tools/read-file.js";
import { WriteFileTool } from "../tools/write-file.js";
import { EditFileTool } from "../tools/edit-file.js";
import { GlobTool } from "../tools/glob.js";
import { GrepTool } from "../tools/grep.js";
import { BashTool } from "../tools/bash.js";
import { Agent } from "../agent/agent.js";
import { PermissionChecker } from "../permissions/checker.js";
import { listSessions } from "../session/session.js";

const DEFAULT_MIN_HOURS = 24;
const DEFAULT_MIN_SESSIONS = 5;
const SCAN_THROTTLE_MS = 10 * 60 * 1000;
const LOCK_FILE = ".consolidate-lock";
const HOLDER_STALE_MS = 60 * 60 * 1000;
const MAX_ENTRYPOINT_LINES = 200;

/**
 * MemoryConsolidator implements background memory consolidation (autoDream).
 * Once both the time gate (>=24h) and session gate (>=5 sessions) are satisfied,
 * it automatically forks a subagent to consolidate memories: merge duplicates,
 * remove stale entries, resolve contradictions, and maintain the index.
 */
export class MemoryConsolidator {
  private client: LLMClient;
  private workDir: string;
  private lastScanAt = 0;
  private minHours: number;
  private minSessions: number;
  private appendSystem?: (msg: string) => void;

  constructor(
    client: LLMClient,
    workDir: string,
    opts?: {
      minHours?: number;
      minSessions?: number;
      appendSystem?: (msg: string) => void;
    },
  ) {
    this.client = client;
    this.workDir = workDir;
    this.minHours = opts?.minHours ?? DEFAULT_MIN_HOURS;
    this.minSessions = opts?.minSessions ?? DEFAULT_MIN_SESSIONS;
    this.appendSystem = opts?.appendSystem;
  }

  /**
   * Checks gating conditions and runs a consolidation pass in the background if met.
   * Should be called after each Agent Loop turn completes.
   */
  maybeRun(): Promise<void> {
    const memDir = join(this.workDir, ".swifty", "memory");
    if (!existsSync(memDir)) {
      return Promise.resolve();
    }

    // Time gate
    const lastAt = readLastConsolidatedAt(memDir);
    const hoursSince = (Date.now() - lastAt) / 3_600_000;
    if (hoursSince < this.minHours) {
      return Promise.resolve();
    }

    // Scan throttle
    const now = Date.now();
    if (now - this.lastScanAt < SCAN_THROTTLE_MS) {
      return Promise.resolve();
    }
    this.lastScanAt = now;

    // Session gate
    const sessionIDs = listSessionsSince(this.workDir, lastAt);
    if (sessionIDs.length < this.minSessions) {
      return Promise.resolve();
    }

    // Acquire lock
    const priorMtime = tryAcquireLock(memDir);
    if (priorMtime === null) {
      return Promise.resolve();
    }

    // Run in the background without blocking
    this.run(memDir, sessionIDs, priorMtime).catch(() => {
      rollbackLock(memDir, priorMtime);
    });
    return Promise.resolve();
  }

  async run(memDir: string, sessionIDs: string[], _priorMtime: number): Promise<void> {
    const userMemDir = join(homedir(), ".swifty", "memory");
    const transcriptDir = join(this.workDir, ".swifty", "sessions");
    const prompt = buildConsolidationPrompt(memDir, userMemDir, transcriptDir, sessionIDs);

    const subRegistry = new ToolRegistry();
    subRegistry.register(new ReadFileTool());
    subRegistry.register(new WriteFileTool());
    subRegistry.register(new EditFileTool());
    subRegistry.register(new GlobTool());
    subRegistry.register(new GrepTool());
    subRegistry.register(new BashTool());

    const subChecker = new PermissionChecker(this.workDir, "bypassPermissions");

    const conv = new ConversationManager();
    conv.addUserMessage(prompt);

    const subagent = new Agent({
      client: this.client,
      registry: subRegistry,
      checker: subChecker,
      conversation: conv,
      workDir: this.workDir,
      maxIterations: 15,
    });

    for await (const e of subagent.run()) {
      console.log(e.type);
      // drain
    }

    const writtenPaths = extractWrittenPaths(conv.getMessages());
    const memoryPaths = writtenPaths.filter((p) => basename(p) !== "MEMORY.md");

    if (memoryPaths.length > 0 && this.appendSystem) {
      const names = memoryPaths.map((p) => basename(p));
      this.appendSystem(`Memory improved: ${names.join(", ")}`);
    }
  }
}

// --- Lock file management ---

function lockPath(memDir: string): string {
  return join(memDir, LOCK_FILE);
}

function readLastConsolidatedAt(memDir: string): number {
  const path = lockPath(memDir);
  if (!existsSync(path)) {
    return 0;
  }
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Acquires the consolidation lock. Returns the previous mtime on success, null on failure.
 */
function tryAcquireLock(memDir: string): number | null {
  const path = lockPath(memDir);
  let mtimeMs: number | undefined;
  let holderPid: number | undefined;

  if (existsSync(path)) {
    try {
      mtimeMs = statSync(path).mtimeMs;
      const raw = readFileSync(path, "utf-8").trim();
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        holderPid = parsed;
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (mtimeMs !== undefined && Date.now() - mtimeMs < HOLDER_STALE_MS) {
    if (holderPid !== undefined && isProcessRunning(holderPid)) {
      return null;
    }
  }

  mkdirSync(memDir, { recursive: true });
  writeFileSync(path, String(process.pid));

  // Read-back verification
  try {
    const verify = readFileSync(path, "utf-8").trim();
    if (parseInt(verify, 10) !== process.pid) {
      return null;
    }
  } catch {
    return null;
  }

  return mtimeMs ?? 0;
}

function rollbackLock(memDir: string, priorMtime: number): void {
  const path = lockPath(memDir);
  try {
    if (priorMtime === 0) {
      unlinkSync(path);
      return;
    }
    writeFileSync(path, "");
    const t = priorMtime / 1000;
    utimesSync(path, t, t);
  } catch (err) {
    console.error(err);
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- Session listing ---

function listSessionsSince(workDir: string, sinceMs: number): string[] {
  const sessions = listSessions(workDir);
  const since = new Date(sinceMs);
  return sessions.filter((s) => s.modTime > since).map((s) => s.id);
}

// --- Prompt ---

function buildConsolidationPrompt(
  memDir: string,
  userMemDir: string,
  transcriptDir: string,
  sessionIDs: string[],
): string {
  const lines: string[] = [
    `# Dream: Memory Consolidation`,
    ``,
    `You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.`,
    ``,
    `Project memory directory: \`${memDir}\``,
    `User memory directory: \`${userMemDir}\``,
    `The memory directory already exists — write to it directly.`,
    ``,
    `Session transcripts: \`${transcriptDir}\` (large JSONL files — grep narrowly, don't read whole files)`,
    ``,
    `---`,
    ``,
    `## Phase 1 — Orient`,
    ``,
    `- \`ls\` the memory directory to see what already exists`,
    `- Read \`MEMORY.md\` to understand the current index`,
    `- Skim existing topic files so you improve them rather than creating duplicates`,
    ``,
    `## Phase 2 — Gather recent signal`,
    ``,
    `Look for new information worth persisting:`,
    ``,
    `1. **Existing memories that drifted** — facts that contradict something you see in the codebase now`,
    `2. **Transcript search** — if you need specific context, grep the JSONL transcripts for narrow terms`,
    ``,
    `Don't exhaustively read transcripts. Look only for things you already suspect matter.`,
    ``,
    `## Phase 3 — Consolidate`,
    ``,
    `For each thing worth remembering, write or update a memory file. Each memory file uses YAML frontmatter with name, description, and metadata.type fields, followed by a Markdown body.`,
    ``,
    `Focus on:`,
    `- Merging new signal into existing topic files rather than creating near-duplicates`,
    `- Converting relative dates ("yesterday", "last week") to absolute dates so they remain interpretable after time passes`,
    `- Deleting contradicted facts — if today's investigation disproves an old memory, fix it at the source`,
    ``,
    `## Phase 4 — Prune and index`,
    ``,
    `Update \`MEMORY.md\` so it stays under ${String(MAX_ENTRYPOINT_LINES)} lines AND under ~25KB. It's an **index**, not a dump — each entry should be one line under ~150 characters: \`- [Title](file.md) — one-line hook\`. Never write memory content directly into it.`,
    ``,
    `- Remove pointers to memories that are now stale, wrong, or superseded`,
    `- Demote verbose entries: if an index line is over ~200 chars, it's carrying content that belongs in the topic file — shorten the line, move the detail`,
    `- Add pointers to newly important memories`,
    `- Resolve contradictions — if two files disagree, fix the wrong one`,
    ``,
    `---`,
    ``,
    `**Tool constraints for this run:** Bash is restricted to read-only commands (\`ls\`, \`find\`, \`grep\`, \`cat\`, \`stat\`, \`wc\`, \`head\`, \`tail\`, and similar). Anything that writes, redirects to a file, or modifies state will be denied.`,
    ``,
  ];

  if (sessionIDs.length > 0) {
    lines.push(`Sessions since last consolidation (${String(sessionIDs.length)}):`);
    for (const id of sessionIDs) {
      lines.push(`- ${id}`);
    }
  }

  lines.push(
    ``,
    `Return a brief summary of what you consolidated, updated, or pruned. If nothing changed (memories are already tight), say so.`,
  );

  return lines.join("\n");
}

// --- Helpers ---

function extractWrittenPaths(messages: { role: string; content: string }[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") {
      continue;
    }
    const matches = msg.content.matchAll(/"file_path"\s*:\s*"([^"]+)"/g);
    for (const m of matches) {
      if (m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        paths.push(m[1]);
      }
    }
  }
  return paths;
}
