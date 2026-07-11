import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { LLMClient } from "../llm/client.js";
import { ConversationManager } from "../conversation/conversation.js";
import { MemoryManager } from "./manager.js";
import { ToolRegistry } from "../tools/registry.js";
import { ReadFileTool } from "../tools/read-file.js";
import { WriteFileTool } from "../tools/write-file.js";
import { EditFileTool } from "../tools/edit-file.js";
import { GlobTool } from "../tools/glob.js";
import { GrepTool } from "../tools/grep.js";
import { Agent } from "../agent/agent.js";
import { PermissionChecker } from "../permissions/checker.js";

/** A memory block parsed from LLM streamed text (MEMORY_NAME/MEMORY_TYPE/MEMORY_DESC/MEMORY_BODY). */
interface ParsedTextMemory {
  name: string;
  type: string;
  description: string;
  body: string;
}

/**
 * MemoryExtractor implements the background memory-extraction subagent.
 * Mirrors the Go extractor.go logic:
 * - Uses a child agent + tools (ReadFile/WriteFile/EditFile) instead of bare LLM calls
 * - Sends existing memory manifest to the LLM before extraction for deduplication
 * - turnsSinceLastExtraction throttling
 * - inProgress + pendingContext merge strategy
 * - When the child agent makes no tool calls, falls back to parsing streamed
 *   text blocks (MEMORY_NAME/...) and writing them to disk
 */
export class MemoryExtractor {
  private client: LLMClient;
  private workDir: string;
  private inProgress = false;
  private pendingContext: string | null = null;
  private turnsSinceLastExtraction = 0;
  private lastMemoryMessageIdx = 0;

  constructor(client: LLMClient, workDir: string) {
    this.client = client;
    this.workDir = workDir;
  }

  async extract(conversationSummary: string): Promise<string[]> {
    if (this.inProgress) {
      this.pendingContext = conversationSummary;
      return [];
    }
    return this.runExtraction(conversationSummary, false);
  }

  private async runExtraction(
    conversationSummary: string,
    isTrailingRun: boolean,
  ): Promise<string[]> {
    // Throttle: at least 1 round apart (trailing runs skip throttling)
    if (!isTrailingRun) {
      this.turnsSinceLastExtraction++;
      if (this.turnsSinceLastExtraction < 1) {
        return [];
      }
    }
    this.turnsSinceLastExtraction = 0;

    this.inProgress = true;
    let result: string[] = [];

    try {
      result = await this.doExtract(conversationSummary);
    } finally {
      this.inProgress = false;
      const pending = this.pendingContext;
      this.pendingContext = null;
      if (pending !== null) {
        const trailingResult = await this.runExtraction(pending, true);
        result = [...result, ...trailingResult];
      }
    }

    return result;
  }

  /** Scan existing memory files and build a manifest for LLM deduplication */
  private scanExistingMemories(): string {
    const dirs = [join(this.workDir, ".swifty", "memory"), join(homedir(), ".swifty", "memory")];
    const entries: string[] = [];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        continue;
      }
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
        for (const file of files) {
          try {
            const content = readFileSync(join(dir, file), "utf-8");
            // const nameMatch = /name:\s*(.+)/.exec(content);
            const typeMatch = /type:\s*(.+)/.exec(content);
            const descMatch = /description:\s*(.+)/.exec(content);
            // const name = nameMatch?.[1]?.trim() ?? file;
            const type = typeMatch?.[1]?.trim() ?? "reference";
            const desc = descMatch?.[1]?.trim() ?? "";
            entries.push(`- [${type}] ${file}: ${desc}`);
          } catch {
            /** noop */
          }
        }
      } catch {
        /** noop */
      }
    }

    return entries.length > 0 ? entries.join("\n") : "";
  }

  /** Build the extraction prompt (mirrors Go prompts.go) */
  private buildExtractionPrompt(conversationSummary: string): string {
    const manifest = this.scanExistingMemories();
    const projectMemDir = join(this.workDir, ".swifty", "memory");
    const userMemDir = join(homedir(), ".swifty", "memory");

    let manifestSection = "";
    if (manifest) {
      manifestSection = `\n\n## Existing memory files\n\n${manifest}\n\nCheck this list before writing — update an existing file rather than creating a duplicate.`;
    }

    return [
      `You are now acting as the memory extraction subagent. Analyze the conversation below and use the tools to update persistent memory files.`,
      ``,
      `Available tools: ReadFile, WriteFile, EditFile, Glob, Grep. EditFile requires a prior ReadFile of the same file.`,
      ``,
      `You have a limited turn budget. The efficient strategy is: turn 1 — issue all ReadFile calls in parallel for every file you might update; turn 2 — issue all WriteFile/EditFile calls in parallel.`,
      ``,
      `You MUST only use content from the conversation to update memories. Do not investigate source code.${manifestSection}`,
      ``,
      `## Memory storage paths`,
      ``,
      `- \`user\` and \`feedback\` type → write to \`${userMemDir}/\` (user-level; follows the human across projects)`,
      `- \`project\` and \`reference\` type → write to \`${projectMemDir}/\` (project-level; lives with this repo)`,
      ``,
      `Pick the type first, then write the memory file (and its MEMORY.md pointer) into the matching directory.`,
      ``,
      `## Memory types`,
      ``,
      `- **user**: Information about the user's role, goals, preferences, knowledge`,
      `- **feedback**: Guidance the user gave about how to approach work (corrections AND confirmations)`,
      `- **project**: Ongoing work, goals, decisions, deadlines within the project`,
      `- **reference**: Pointers to external resources (URLs, docs, tools)`,
      ``,
      `## What NOT to save`,
      ``,
      `- Code patterns, architecture, file paths — derivable from reading the project`,
      `- Git history — use git log/blame`,
      `- Debugging solutions — the fix is in the code`,
      `- Anything in CLAUDE.md / SWIFTY.md files`,
      `- Ephemeral task details, current conversation context`,
      ``,
      `## How to save memories`,
      ``,
      `**Step 1** — write the memory to its own file using this frontmatter format:`,
      ``,
      "```markdown",
      `---`,
      `name: {{short-kebab-case-slug}}`,
      `description: {{one-line summary}}`,
      `metadata:`,
      `  type: {{user, feedback, project, reference}}`,
      `---`,
      ``,
      `{{memory content}}`,
      "```",
      ``,
      `**Step 2** — add a pointer to MEMORY.md in the SAME directory. Each entry one line: \`- [Title](file.md) — one-line hook\``,
      ``,
      `- Do not write duplicate memories. Check existing files first.`,
      `- If no memories are worth saving, do nothing.`,
      ``,
      `## Conversation to analyze`,
      ``,
      conversationSummary,
    ].join("\n");
  }

  /** Core extraction logic: child agent + tools */
  private async doExtract(conversationSummary: string): Promise<string[]> {
    const extractionPrompt = this.buildExtractionPrompt(conversationSummary);

    // Build the child agent tool registry (file-operation tools only)
    const subRegistry = new ToolRegistry();
    subRegistry.register(new ReadFileTool());
    subRegistry.register(new WriteFileTool());
    subRegistry.register(new EditFileTool());
    subRegistry.register(new GlobTool());
    subRegistry.register(new GrepTool());

    // Bypass permissions (background agent requires no user confirmation)
    const subChecker = new PermissionChecker(this.workDir, "bypassPermissions");

    const forkedConv = new ConversationManager();
    forkedConv.addUserMessage(extractionPrompt);

    const subagent = new Agent({
      client: this.client,
      registry: subRegistry,
      checker: subChecker,
      conversation: forkedConv,
      workDir: this.workDir,
      maxIterations: 5,
    });

    // Drive the child agent to completion without propagating events to the UI;
    // concurrently collect streamed text as a fallback parse source when the LLM
    // issues no tool calls (i.e., emits structured text blocks directly).
    let streamedText = "";
    for await (const event of subagent.run()) {
      if (event.type === "stream_text") {
        streamedText += event.text;
      }
      // drain
    }

    // Fast path: LLM wrote memory files directly using WriteFile/EditFile tools
    const writtenPaths = this.extractWrittenPaths(forkedConv.getMessages());
    const memoryPaths = writtenPaths.filter((p) => basename(p) !== "MEMORY.md");

    let saved: string[];
    if (memoryPaths.length > 0) {
      saved = memoryPaths.map((p) => basename(p));
    } else {
      // Fallback path: LLM emitted MEMORY_NAME/... text blocks directly; parse locally and persist
      saved = this.persistTextMemories(streamedText);
    }

    // Rebuild index after writing
    if (saved.length > 0) {
      const mgr = new MemoryManager(this.workDir);
      mgr.rebuildIndex();
    }

    return saved;
  }

  /** Extract file paths from WriteFile/EditFile tool calls in conversation messages */
  private extractWrittenPaths(messages: { role: string; content: string }[]): string[] {
    const paths: string[] = [];
    for (const msg of messages) {
      if (msg.role !== "assistant") {
        continue;
      }
      // Match the file_path argument in tool_use blocks
      const filePathMatches = msg.content.matchAll(/"file_path"\s*:\s*"([^"]+)"/g);
      for (const m of filePathMatches) {
        if (m[1] && (m[1].includes("memory") || m[1].endsWith(".md"))) {
          paths.push(m[1]);
        }
      }
    }
    return [...new Set(paths)];
  }

  /**
   * Text protocol fallback: when the sub-agent did not invoke any tools but
   * instead emitted structured text blocks (MEMORY_NAME/MEMORY_TYPE/MEMORY_DESC/MEMORY_BODY,
   * separated by a standalone `---` line), parse them locally and persist by type.
   * Returns the list of written memory names (without extensions).
   */
  private persistTextMemories(text: string): string[] {
    const memories = this.parseTextMemoryBlocks(text);
    if (memories.length === 0) {
      return [];
    }

    const saved: string[] = [];
    for (const mem of memories) {
      const dir = this.dirForMemoryType(mem.type);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${mem.name}.md`), this.formatMemoryFile(mem), "utf-8");
      saved.push(mem.name);
    }
    return saved;
  }

  /** Parse structured text blocks; returns empty array for NONE or empty text. */
  private parseTextMemoryBlocks(text: string): ParsedTextMemory[] {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === "NONE") {
      return [];
    }

    const memories: ParsedTextMemory[] = [];
    // Split on standalone --- lines (m flag lets ^/$ match line start/end)
    const blocks = trimmed.split(/^---\s*$/m);
    for (const block of blocks) {
      const mem = this.parseTextMemoryBlock(block);
      if (mem) {
        memories.push(mem);
      }
    }
    return memories;
  }

  /** Parse a single block; MEMORY_BODY supports multi-line. Returns null for blocks without MEMORY_NAME. */
  private parseTextMemoryBlock(block: string): ParsedTextMemory | null {
    const lines = block.split("\n");
    const mem: ParsedTextMemory = {
      name: "",
      type: "",
      description: "",
      body: "",
    };
    const bodyLines: string[] = [];
    let inBody = false;

    for (const line of lines) {
      const nameMatch = /^MEMORY_NAME:\s*(.*)$/i.exec(line);
      const typeMatch = /^MEMORY_TYPE:\s*(.*)$/i.exec(line);
      const descMatch = /^MEMORY_DESC:\s*(.*)$/i.exec(line);
      const bodyMatch = /^MEMORY_BODY:\s?(.*)$/i.exec(line);

      if (nameMatch) {
        mem.name = nameMatch[1].trim();
        inBody = false;
      } else if (typeMatch) {
        mem.type = typeMatch[1].trim();
        inBody = false;
      } else if (descMatch) {
        mem.description = descMatch[1].trim();
        inBody = false;
      } else if (bodyMatch) {
        mem.body = bodyMatch[1];
        inBody = true;
      } else if (inBody) {
        bodyLines.push(line);
      }
    }

    if (mem.body) {
      mem.body = [mem.body, ...bodyLines].join("\n").replace(/\s+$/, "");
    }

    if (!mem.name) {
      return null;
    }
    if (!mem.type) {
      // Default to project-level reference when no type is given
      mem.type = "reference";
    }
    return mem;
  }

  /** Route to the appropriate directory by type: user/feedback -> user-level; otherwise -> project-level */
  private dirForMemoryType(type: string): string {
    const t = type.toLowerCase();
    if (t === "user" || t === "feedback") {
      return join(homedir(), ".swifty", "memory");
    }
    return join(this.workDir, ".swifty", "memory");
  }

  /** Format a memory file: frontmatter (name/description/type) + body */
  private formatMemoryFile(mem: ParsedTextMemory): string {
    return [
      "---",
      `name: ${mem.name}`,
      `description: ${mem.description}`,
      `type: ${mem.type}`,
      "---",
      "",
      mem.body,
      "",
    ].join("\n");
  }
}
