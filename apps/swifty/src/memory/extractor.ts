import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
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

/** 一条从 LLM 流式文本中解析出的记忆块（MEMORY_NAME/MEMORY_TYPE/MEMORY_DESC/MEMORY_BODY）。 */
interface ParsedTextMemory {
  name: string;
  type: string;
  description: string;
  body: string;
}

/**
 * MemoryExtractor 实现后台记忆提取子代理。
 * 参照 Go 版 extractor.go 的提取逻辑：
 * - 用子 agent + 工具（ReadFile/WriteFile/EditFile）替代裸 LLM 调用
 * - 提取前发送已有记忆 manifest 给 LLM 做去重
 * - turnsSinceLastExtraction 节流
 * - inProgress + pendingContext 合并策略
 * - 子 agent 未发起工具调用时，回退解析其流式文本块（MEMORY_NAME/...）并落盘
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
    // 节流：至少间隔 1 轮（trailing run 跳过节流）
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

  /** 扫描已有记忆文件，生成 manifest 给 LLM 做去重 */
  private scanExistingMemories(): string {
    const dirs = [
      join(this.workDir, ".swifty", "memory"),
      join(homedir(), ".swifty", "memory"),
    ];
    const entries: string[] = [];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        continue;
      }
      try {
        const files = readdirSync(dir).filter(
          (f) => f.endsWith(".md") && f !== "MEMORY.md",
        );
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

  /** 构建提取 prompt（参照 Go 版 prompts.go） */
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

  /** 核心提取逻辑：用子 agent + 工具 */
  private async doExtract(conversationSummary: string): Promise<string[]> {
    const extractionPrompt = this.buildExtractionPrompt(conversationSummary);

    // 构建子 agent 的工具注册表（只包含文件操作工具）
    const subRegistry = new ToolRegistry();
    subRegistry.register(new ReadFileTool());
    subRegistry.register(new WriteFileTool());
    subRegistry.register(new EditFileTool());
    subRegistry.register(new GlobTool());
    subRegistry.register(new GrepTool());

    // bypass 权限（后台 agent 不需要用户确认）
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

    // 驱动子 agent 到完成，不传播事件到 UI；同时收集流式文本，作为 LLM 未发起
    // 工具调用（直接输出结构化文本块）时的回退解析来源
    let streamedText = "";
    for await (const event of subagent.run()) {
      if (event.type === "stream_text") {
        streamedText += event.text;
      }
      // drain
    }

    // 优先路径：LLM 通过 WriteFile/EditFile 工具直接写入了记忆文件
    const writtenPaths = this.extractWrittenPaths(forkedConv.getMessages());
    const memoryPaths = writtenPaths.filter((p) => basename(p) !== "MEMORY.md");

    let saved: string[];
    if (memoryPaths.length > 0) {
      saved = memoryPaths.map((p) => basename(p));
    } else {
      // 回退路径：LLM 直接输出了 MEMORY_NAME/... 文本块，由本机解析并落盘
      saved = this.persistTextMemories(streamedText);
    }

    // 写入后重建索引
    if (saved.length > 0) {
      const mgr = new MemoryManager(this.workDir);
      mgr.rebuildIndex();
    }

    return saved;
  }

  /** 从对话消息中提取 WriteFile/EditFile 工具调用的文件路径 */
  private extractWrittenPaths(
    messages: { role: string; content: string }[],
  ): string[] {
    const paths: string[] = [];
    for (const msg of messages) {
      if (msg.role !== "assistant") {
        continue;
      }
      // 匹配 tool_use 中的 file_path 参数
      const filePathMatches = msg.content.matchAll(
        /"file_path"\s*:\s*"([^"]+)"/g,
      );
      for (const m of filePathMatches) {
        if (m[1] && (m[1].includes("memory") || m[1].endsWith(".md"))) {
          paths.push(m[1]);
        }
      }
    }
    return [...new Set(paths)];
  }

  /**
   * 文本协议回退：当子 agent 未发起工具调用、而是直接输出结构化文本块
   * （MEMORY_NAME/MEMORY_TYPE/MEMORY_DESC/MEMORY_BODY，以单独一行的 `---` 分隔）
   * 时，由本机解析并按 type 路由落盘。返回写入的记忆名列表（不含扩展名）。
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
      writeFileSync(
        join(dir, `${mem.name}.md`),
        this.formatMemoryFile(mem),
        "utf-8",
      );
      saved.push(mem.name);
    }
    return saved;
  }

  /** 解析结构化文本块；NONE 或空文本返回空数组。 */
  private parseTextMemoryBlocks(text: string): ParsedTextMemory[] {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === "NONE") {
      return [];
    }

    const memories: ParsedTextMemory[] = [];
    // 按单独一行的 --- 分块（m 标志让 ^/$ 匹配行首/行尾）
    const blocks = trimmed.split(/^---\s*$/m);
    for (const block of blocks) {
      const mem = this.parseTextMemoryBlock(block);
      if (mem) {
        memories.push(mem);
      }
    }
    return memories;
  }

  /** 解析单个块；MEMORY_BODY 支持多行。无 MEMORY_NAME 的块返回 null。 */
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
      // 无类型默认归到项目级 reference
      mem.type = "reference";
    }
    return mem;
  }

  /** 根据 type 路由到对应目录：user/feedback → 用户级，其余 → 项目级 */
  private dirForMemoryType(type: string): string {
    const t = type.toLowerCase();
    if (t === "user" || t === "feedback") {
      return join(homedir(), ".swifty", "memory");
    }
    return join(this.workDir, ".swifty", "memory");
  }

  /** 格式化记忆文件：frontmatter（name/description/type）+ 正文 */
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
