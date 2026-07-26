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

// AgentSession: per-session daemon-side handle around the larky Agent stack.
// Owns the full agent state (LLM client, conversation, tools, permissions,
// hooks, skills, teams, memory, file history) and bridges AgentEvents to wire
// events. Blocking UI callbacks (permission / ask-user / plan approval) are
// delegated to an InteractionBroker implemented by CoreApp with pending maps.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { HookConfig, MCPServerConfig, ProviderConfig } from "../config/config.js";
import type { SandboxYamlConfig } from "../config/config.js";
import { getContextWindow, getContextWindowAsync, getMaxOutputTokens } from "../config/config.js";
import { createClient, type LLMClient } from "../llm/client.js";
import { ConversationManager } from "../conversation/conversation.js";
import { buildSystemPrompt, detectEnvironment } from "../prompt/builder.js";
import { ToolRegistry } from "../tools/registry.js";
import { ReadFileTool } from "../tools/read-file.js";
import { BashTool } from "../tools/bash.js";
import { GlobTool } from "../tools/glob.js";
import { GrepTool } from "../tools/grep.js";
import { WriteFileTool } from "../tools/write-file.js";
import { EditFileTool } from "../tools/edit-file.js";
import { ExitPlanModeTool } from "../tools/exit-plan-mode.js";
import { ToolSearchTool } from "../tools/tool-search.js";
import { EnterWorktreeTool } from "../tools/enter-worktree.js";
import { ExitWorktreeTool } from "../tools/exit-worktree.js";
import { AskUserQuestionTool, type Question } from "../tools/ask-user.js";
import { FileStateCache } from "../tools/file-state-cache.js";
import { SyntheticOutputTool } from "../tools/synthetic-output.js";
import type { ToolSchema } from "../tools/types.js";
import { Agent } from "../agent/agent.js";
import { PermissionChecker, type Decision, type PermissionMode } from "../permissions/checker.js";
import {
  parse as parseCommand,
  createDefaultRegistry as createCommandRegistry,
  type CommandRegistry,
  type CommandContext,
} from "../commands/commands.js";
import { loadUserCommands } from "../commands/loader.js";
import { MCPManager } from "../mcp/manager.js";
import { MCPToolWrapper } from "../mcp/tool-wrapper.js";
import { loadInstructions } from "../memory/instructions.js";
import { MemoryManager } from "../memory/manager.js";
import { MemoryConsolidator } from "../memory/consolidation.js";
import { MemoryExtractor } from "../memory/extractor.js";
import { SkillCatalog } from "../skills/catalog.js";
import type { SkillForkHost, SkillHost } from "../skills/skill.js";
import { LoadSkillTool } from "../skills/load-skill-tool.js";
import { InstallSkillTool } from "../skills/install-tool.js";
import { runInline as runSkillInline, runFork as runSkillFork } from "../skills/executor.js";
import { TaskList } from "../todo/todo.js";
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from "../todo/tools.js";
import { TaskStore } from "../todo/store.js";
import { AgentTool } from "../subagent/agent-tool.js";
import { spawnSubagent } from "../subagent/spawn.js";
import { BUILTIN_AGENTS } from "../subagent/definition.js";
import {
  TeamCreateTool,
  SendMessageTool,
  TeamDeleteTool,
  SpawnTeammateTool,
  ListTeamsTool,
} from "../teams/tools.js";
import { TeamManager, type RunAgent } from "../teams/team.js";
import { TaskStopTool } from "../teams/task-stop.js";
import { coordinatorToolFilter, coordinatorActive } from "../teams/coordinator.js";
import { HookEngine, validate as validateHooks } from "../hooks/hooks.js";
import { forceCompact } from "../compact/compact.js";
import { RecoveryState } from "../compact/recovery.js";
import {
  getOrCreatePlanPath,
  loadPlan,
  planExists,
  resetPlanPath,
} from "../plan-file/plan-file.js";
import { buildPlanModeExitReminder, buildPlanModeReentryReminder } from "../prompt/plan-mode.js";
import { FileHistory, type Snapshot } from "../file-history/file-history.js";
import { createSandbox, type Sandbox } from "../sandbox/index.js";
import * as sessionMod from "../session/session.js";
import { expandAtRefs } from "../tui/at-expand.js";
import { createChildLogger } from "../logger/index.js";
import { asErrorString } from "../utils/index.js";

import type { Event } from "./bus/events.js";
import type { WirePlanChoice } from "./bus/commands.js";

const log = createChildLogger({ module: "agent-session" });

// -- Collaboration interfaces ---------------------------------------------------

/** Emits a wire event (published on the daemon EventBus). */
export type EmitFn = (event: Event) => void;

/** Blocking interaction callbacks answered by clients via *.respond RPCs. */
export interface InteractionBroker {
  requestPermission(
    session: AgentSession,
    toolName: string,
    args: Record<string, unknown>,
    decision: Decision,
  ): Promise<"allow" | "deny" | "allowAlways">;
  askUser(session: AgentSession, questions: Question[]): Promise<Record<string, string>>;
  requestPlanApproval(
    session: AgentSession,
    planText: string,
  ): Promise<{ choice: WirePlanChoice; feedback: string }>;
}

export interface AgentSessionOptions {
  provider: ProviderConfig;
  workDir: string;
  hooks?: HookConfig[];
  mcpServers?: MCPServerConfig[];
  sandboxConfig?: SandboxYamlConfig;
  enableCoordinatorMode: boolean;
  forkDisabled: boolean;
  permissionMode?: PermissionMode;
  persist?: boolean;
  emit: EmitFn;
  broker: InteractionBroker;
}

function nowIso(): string {
  return new Date().toISOString();
}

// -- AgentSession ---------------------------------------------------------------

export class AgentSession {
  // Stable wire session id (used in events/RPC routing).
  id: string;
  // larky persistence session id (changes on /clear and resume).
  larkyId: string;
  workDir: string;
  provider: ProviderConfig;
  permMode: PermissionMode;
  prePlanMode: PermissionMode = "default";

  client!: LLMClient;
  conv = new ConversationManager();
  registry!: ToolRegistry;
  cmdRegistry!: CommandRegistry;
  taskList!: TaskList;
  skillCatalog: SkillCatalog | null = null;
  activeSkills = new Map<string, string>();
  toolFilter: ((name: string) => boolean) | null = null;
  skillHost: SkillHost;
  mcpManager: MCPManager | null = null;
  hookEngine: HookEngine | null = null;
  recoveryState = new RecoveryState();
  teamManager!: TeamManager;
  memoryManager!: MemoryManager;
  fileHistory!: FileHistory;
  fileStateCache = new FileStateCache();
  contextWindow: number;
  ltmInstructions = "";
  ltmMemoryContent = "";
  mcpInstructions = "";
  mcpInfo: { servers: string[]; toolCount: number } | null = null;
  persist: boolean;

  // Sandbox state (toggled via /sandbox)
  sandboxPromise: Promise<Sandbox | null>;
  sandboxEnabled: boolean;
  sandboxAutoAllow: boolean;
  sandboxNetworkEnabled: boolean;

  // Run state
  currentRunId: string | null = null;
  inputTokens = 0;
  outputTokens = 0;
  private abortController: AbortController | null = null;
  private hasExitedPlanMode = false;
  private memCursor = 0;
  private memExtracting = false;
  private memExtractor: MemoryExtractor | null = null;

  private enableCoordinatorMode: boolean;
  private forkDisabled: boolean;
  private emit: EmitFn;
  private broker: InteractionBroker;

  private constructor(opts: AgentSessionOptions) {
    this.id = `sess-${randomUUID().slice(0, 12)}`;
    this.larkyId = sessionMod.newSessionId();
    this.workDir = opts.workDir;
    this.provider = opts.provider;
    this.permMode = opts.permissionMode ?? "default";
    this.persist = opts.persist ?? true;
    this.enableCoordinatorMode = opts.enableCoordinatorMode;
    this.forkDisabled = opts.forkDisabled;
    this.emit = opts.emit;
    this.broker = opts.broker;
    this.contextWindow = getContextWindow(opts.provider);
    this.sandboxPromise = createSandbox();
    this.sandboxEnabled = opts.sandboxConfig?.enabled ?? false;
    this.sandboxAutoAllow = opts.sandboxConfig?.auto_allow ?? false;
    this.sandboxNetworkEnabled = opts.sandboxConfig?.network_enabled ?? true;
    this.skillHost = {
      activateSkill: (name, body) => this.activeSkills.set(name, body),
    };
  }

  /** Initializes the full agent stack (mirrors larky TUI initClient). */
  static async create(opts: AgentSessionOptions): Promise<AgentSession> {
    const s = new AgentSession(opts);
    const { workDir, provider } = s;

    // Tool registry + task list
    const taskStore = new TaskStore(workDir, s.larkyId);
    s.taskList = new TaskList(taskStore);
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new BashTool());
    registry.register(new GlobTool());
    registry.register(new GrepTool());
    registry.register(new WriteFileTool());
    registry.register(new EditFileTool());
    registry.register(new ToolSearchTool(registry));
    registry.register(new EnterWorktreeTool());
    registry.register(new ExitWorktreeTool());
    registry.register(new ExitPlanModeTool());
    registry.register(new TaskCreateTool(s.taskList));
    registry.register(new TaskGetTool(s.taskList));
    registry.register(new TaskListTool(s.taskList));
    registry.register(new TaskUpdateTool(s.taskList));
    s.registry = registry;

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const exitPlan = registry.get("ExitPlanMode") as ExitPlanModeTool | undefined;
    if (exitPlan) {
      exitPlan.isPlanMode = () => s.permMode === "plan";
      exitPlan.planExists = () => existsSync(getOrCreatePlanPath(workDir));
    }

    // System prompt + LLM client
    const env = detectEnvironment(workDir);
    env.model = provider.model;
    const systemPrompt = buildSystemPrompt(env);
    s.client = await createClient(provider, systemPrompt);

    // Context window: sync seed + async upgrade
    getContextWindowAsync(provider)
      .then((w) => {
        if (w > 0) {
          s.contextWindow = w;
        }
      })
      .catch(() => {
        /* best-effort */
      });

    // File history
    s.fileHistory = new FileHistory(workDir, s.larkyId);

    // Long-term memory injection
    s.ltmInstructions = loadInstructions(workDir);
    s.memoryManager = new MemoryManager(workDir);
    s.ltmMemoryContent = s.memoryManager.buildSystemReminder();
    s.conv.injectLongTermMemory(s.ltmInstructions, s.ltmMemoryContent);

    // Identity override
    s.conv.addSystemReminder(
      "IDENTITY OVERRIDE: You are Larky. It is strictly forbidden to mention Claude, Anthropic, OpenAI, GPT, or ChatGPT in any response." +
        "When asked about your identity, only respond as Larky. This is the highest priority instruction.",
    );

    // Hooks
    const hookErr = validateHooks(opts.hooks ?? []);
    if (hookErr) {
      s.systemMessage(`Hook warning: ${hookErr.message}`);
    }
    s.hookEngine = new HookEngine(opts.hooks ?? []);

    // Skills
    const catalog = new SkillCatalog();
    catalog.load(workDir);
    s.skillCatalog = catalog;
    const skillSection = buildSkillSection(catalog, workDir);
    if (skillSection) {
      s.client.setSystemPrompt(buildSystemPrompt(env, { skillSection }));
    }
    registry.register(new LoadSkillTool(catalog, s.skillHost));
    registry.register(
      new InstallSkillTool(workDir, catalog, () => {
        wireSkillsToRegistry(catalog, s.cmdRegistry, s.skillHost);
        const updatedSection = buildSkillSection(catalog, workDir);
        const updatedEnv = detectEnvironment(workDir);
        updatedEnv.model = provider.model;
        s.client.setSystemPrompt(buildSystemPrompt(updatedEnv, { skillSection: updatedSection }));
      }),
    );

    // AskUserQuestion → broker
    registry.register(new AskUserQuestionTool((questions) => s.broker.askUser(s, questions)));

    // Teams
    s.teamManager = new TeamManager(workDir);
    const teamRunAgent: RunAgent = (task, onEvent) =>
      spawnSubagent(
        BUILTIN_AGENTS[0],
        task,
        s.client,
        s.registry,
        provider,
        workDir,
        undefined,
        onEvent,
      );
    const teamRunAgentFactory =
      (teamRegistry: ToolRegistry): RunAgent =>
      (task, onEvent) =>
        spawnSubagent(
          BUILTIN_AGENTS[0],
          task,
          s.client,
          teamRegistry,
          provider,
          workDir,
          undefined,
          onEvent,
        );
    registry.register(new TeamCreateTool(s.teamManager));
    registry.register(new SpawnTeammateTool(s.teamManager, teamRunAgent));
    registry.register(new SendMessageTool(s.teamManager));
    registry.register(new ListTeamsTool(s.teamManager));
    registry.register(new TeamDeleteTool(s.teamManager));
    registry.register(new TaskStopTool(s.teamManager));
    registry.register(new SyntheticOutputTool());

    // Slash commands: built-ins + user commands + skills
    s.cmdRegistry = createCommandRegistry();
    for (const cmd of loadUserCommands(workDir)) {
      try {
        s.cmdRegistry.register(cmd);
      } catch {
        // name clash → keep built-in
      }
    }
    wireSkillsToRegistry(catalog, s.cmdRegistry, s.skillHost);

    // Subagent tool with progress events
    let subagentSeq = 0;
    const agentTool = new AgentTool(
      workDir,
      registry,
      async (def, prompt, _bg, modelOverride?, workDirOverride?) => {
        const taskId = `sub-${String(++subagentSeq)}`;
        s.emitSubagentProgress(taskId, def.name, "running", "");
        const onProgress = (p: { turn?: number; lastTool?: string }) => {
          s.emitSubagentProgress(
            taskId,
            def.name,
            "running",
            p.lastTool
              ? `turn ${String(p.turn ?? 0)} · ${p.lastTool}`
              : `turn ${String(p.turn ?? 0)}`,
          );
        };
        try {
          return await spawnSubagent(
            def,
            prompt,
            s.client,
            s.registry,
            provider,
            workDirOverride ?? workDir,
            onProgress,
            undefined,
            modelOverride,
          );
        } finally {
          s.emitSubagentProgress(taskId, def.name, "done", "");
        }
      },
    );
    agentTool.forkDisabled = opts.forkDisabled;
    agentTool.setTeamManager(s.teamManager, teamRunAgentFactory);
    registry.register(agentTool);

    // MCP servers (background connect)
    if (opts.mcpServers && opts.mcpServers.length > 0) {
      const mgr = new MCPManager();
      s.mcpManager = mgr;
      void mgr.connectAll(opts.mcpServers).then((result) => {
        for (const { serverName, tool } of result.tools) {
          const mcpClient = mgr.getClient(serverName);
          if (mcpClient) {
            s.registry.register(new MCPToolWrapper(mcpClient, serverName, tool));
          }
        }
        if (result.errors.length > 0) {
          s.systemMessage(
            `MCP errors: ${result.errors.map((e) => `${e.serverName}: ${e.error}`).join("; ")}`,
          );
        }
        if (result.servers.length > 0) {
          s.mcpInfo = {
            servers: result.servers,
            toolCount: result.tools.length,
          };
        }
        for (const { serverName, text } of result.instructions) {
          s.conv.addSystemReminder(`# MCP Server: ${serverName}\n${text}`);
        }
      });
    }

    return s;
  }

  // -- Event helpers --------------------------------------------------------

  systemMessage(message: string): void {
    this.emit({
      type: "system.message",
      session_id: this.id,
      message,
      timestamp: nowIso(),
    });
  }

  commandDone(): void {
    this.emit({
      type: "command.done",
      session_id: this.id,
      timestamp: nowIso(),
    });
  }

  private emitSubagentProgress(
    taskId: string,
    description: string,
    status: string,
    detail: string,
  ): void {
    this.emit({
      type: "subagent.progress",
      session_id: this.id,
      task_id: taskId,
      description,
      status,
      detail,
      timestamp: nowIso(),
    });
  }

  private emitTodos(): void {
    this.emit({
      type: "todo.updated",
      session_id: this.id,

      todos: this.taskList.list().map((t) => ({ ...t })),
      timestamp: nowIso(),
    });
  }

  emitModeChanged(): void {
    this.emit({
      type: "mode.changed",
      session_id: this.id,
      mode: this.permMode,
      timestamp: nowIso(),
    });
  }

  // -- Mode / lifecycle -------------------------------------------------------

  setMode(mode: PermissionMode): void {
    if (mode === "plan" && this.permMode !== "plan") {
      this.prePlanMode = this.permMode;
    }
    this.permMode = mode;
    this.emitModeChanged();
  }

  get isRunning(): boolean {
    return this.currentRunId !== null;
  }

  cancel(): boolean {
    if (!this.abortController) {
      return false;
    }
    this.abortController.abort();
    return true;
  }

  async close(): Promise<void> {
    this.cancel();
    try {
      await this.mcpManager?.disconnectAll();
    } catch {
      // best-effort
    }
    this.emit({
      type: "session.closed",
      session_id: this.id,
      timestamp: nowIso(),
    });
  }

  // -- Message run ------------------------------------------------------------

  /**
   * Starts an agent run for a user message. Returns the run id immediately;
   * progress is delivered through wire events. displayText (if different)
   * is what gets persisted, e.g. "/review foo" while the rendered prompt runs.
   */
  startRun(text: string, opts?: { displayText?: string; skipUserMessage?: boolean }): string {
    if (this.isRunning) {
      // Steering: interrupt the in-flight run, then queue the new message.
      this.cancel();
    }
    const runId = `run-${randomUUID().slice(0, 12)}`;
    this.currentRunId = runId;

    const display = opts?.displayText ?? text;
    if (!opts?.skipUserMessage) {
      // Inline @file references for the model; persist the original text.
      this.conv.addUserMessage(expandAtRefs(text, this.workDir));
      if (this.persist) {
        sessionMod.saveMessage(this.workDir, this.larkyId, {
          role: "user",
          content: display,
          timestamp: Math.floor(Date.now() / 1000),
        });
      }
    }

    this.emit({
      type: "run.started",
      session_id: this.id,
      run_id: runId,
      content: display,
      timestamp: nowIso(),
    });

    void this._runLoop(runId).finally(() => {
      if (this.currentRunId === runId) {
        this.currentRunId = null;
      }
    });
    return runId;
  }

  private async _runLoop(runId: string): Promise<void> {
    const startTime = Date.now();
    let stopReason = "end_turn";
    let turnCount = 0;

    const controller = new AbortController();
    this.abortController = controller;

    try {
      this.refreshSkillsIfNeeded();

      const checker = new PermissionChecker(this.workDir, this.permMode);
      checker.sandboxEnabled = this.sandboxEnabled;
      checker.sandboxAutoAllow = this.sandboxAutoAllow;

      // Attach/detach sandbox on the Bash tool
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const bashTool = this.registry.get("Bash") as BashTool | undefined;
      if (bashTool && this.sandboxEnabled) {
        bashTool.sandbox = await this.sandboxPromise;
        bashTool.sandboxConfig = {
          allowWrite: [this.workDir, "/tmp"],
          denyWrite: [
            join(this.workDir, ".larky", "config.yaml"),
            join(this.workDir, ".larky", "permissions.local.yaml"),
            join(this.workDir, ".larky", "skills"),
          ],
          networkEnabled: this.sandboxNetworkEnabled,
        };
      } else if (bashTool) {
        bashTool.sandbox = null;
      }

      // One-time MCP instructions injection
      if (this.mcpInstructions) {
        this.conv.addSystemReminder(this.mcpInstructions);
        this.mcpInstructions = "";
      }

      // Memory recall (non-blocking)
      const lastUser =
        this.conv
          .getMessages()
          .filter((m) => m.role === "user")
          .pop()?.content ?? "";
      const recallPromise = this.memoryManager
        .findRelevantMemories(lastUser, this.client)
        .then((memories) => {
          if (memories.length === 0) {
            return "";
          }
          const lines = memories
            .map((m) => {
              try {
                return readFileSync(m.path, "utf-8");
              } catch {
                return "";
              }
            })
            .filter(Boolean);
          return lines.length > 0
            ? "<system-reminder>\n# Recalled Memories\n\n" +
                lines.join("\n\n") +
                "\n</system-reminder>"
            : "";
        })
        .catch(() => "");

      const agent = new Agent({
        client: this.client,
        registry: this.registry,
        checker,
        conversation: this.conv,
        workDir: this.workDir,
        sessionId: this.persist ? this.larkyId : undefined,
        hookEngine: this.hookEngine ?? undefined,
        fileHistory: this.fileHistory,
        fileStateCache: this.fileStateCache,
        abortSignal: controller.signal,
        contextWindow: this.contextWindow,
        maxOutput: getMaxOutputTokens(this.provider),
        recoveryState: this.recoveryState,
        activeSkills: this.activeSkills,
        memoryRecallPromise: recallPromise,
        toolFilter: (name: string) => {
          if (!coordinatorToolFilter(this.enableCoordinatorMode)(name)) {
            return false;
          }
          return this.toolFilter ? this.toolFilter(name) : true;
        },
        coordinatorActiveFn: () => coordinatorActive(this.enableCoordinatorMode),
        notificationFn: () => this.teamManager.drainLeads(),
        onLoopComplete: (conv) => {
          this.extractMemories(conv);
        },
        onPermissionRequest: (toolName, args, decision) =>
          this.broker.requestPermission(this, toolName, args, decision),
      });

      for await (const event of agent.run()) {
        const ts = nowIso();
        switch (event.type) {
          case "stream_text":
            this.emit({
              type: "agent.stream_text",
              session_id: this.id,
              run_id: runId,
              text: event.text,
              timestamp: ts,
            });
            break;
          case "thinking_text":
            this.emit({
              type: "agent.thinking_text",
              session_id: this.id,
              run_id: runId,
              text: event.text,
              timestamp: ts,
            });
            break;
          case "thinking_complete":
            this.emit({
              type: "agent.thinking_complete",
              session_id: this.id,
              run_id: runId,
              thinking: event.thinking,
              timestamp: ts,
            });
            break;
          case "tool_use":
            this.emit({
              type: "agent.tool_use",
              session_id: this.id,
              run_id: runId,
              tool_id: event.toolId,
              tool_name: event.toolName,
              args: event.args,
              timestamp: ts,
            });
            break;
          case "tool_result":
            this.emit({
              type: "agent.tool_result",
              session_id: this.id,
              run_id: runId,
              tool_id: event.toolId,
              tool_name: event.toolName,
              output: event.output,
              is_error: event.isError,
              elapsed_ms: Math.round(event.elapsed),
              timestamp: ts,
            });
            // Task* tools mutate the todo store → push fresh state.
            if (event.toolName.startsWith("Task")) {
              this.emitTodos();
            }
            break;
          case "turn_complete":
            turnCount++;
            this.emit({
              type: "agent.turn_complete",
              session_id: this.id,
              run_id: runId,
              turn: turnCount,
              timestamp: ts,
            });
            break;
          case "loop_complete":
            stopReason = event.stopReason;
            break;
          case "usage":
            this.inputTokens += event.usage.inputTokens;
            this.outputTokens += event.usage.outputTokens;
            this.emit({
              type: "agent.usage",
              session_id: this.id,
              run_id: runId,
              input_tokens: event.usage.inputTokens,
              output_tokens: event.usage.outputTokens,
              cache_read_input_tokens: event.usage.cacheReadInputTokens,
              cache_creation_input_tokens: event.usage.cacheCreationInputTokens,
              timestamp: ts,
            });
            break;
          case "compact":
            this.emit({
              type: "agent.compact",
              session_id: this.id,
              run_id: runId,
              message: event.message,
              timestamp: ts,
            });
            if (event.boundary && this.persist) {
              sessionMod.saveCompactBoundary(this.workDir, this.larkyId, event.boundary);
            }
            break;
          case "retry":
            this.emit({
              type: "agent.retry",
              session_id: this.id,
              run_id: runId,
              reason: event.reason,
              delay_ms: Math.round(event.delay),
              timestamp: ts,
            });
            break;
          case "error":
            throw event.error;
          case "permission_request":
            // Handled via onPermissionRequest callback; never yielded.
            break;
        }
      }
    } catch (err) {
      const msg = asErrorString(err);
      const isAbort =
        controller.signal.aborted ||
        (err instanceof Error && err.name === "AbortError") ||
        msg.includes("abort");
      if (isAbort) {
        stopReason = "interrupted";
        this.systemMessage("(response interrupted)");
      } else {
        stopReason = "error";
        log.error({ err }, "agent run failed");
        this.emit({
          type: "agent.error",
          session_id: this.id,
          run_id: runId,
          message: msg,
          timestamp: nowIso(),
        });
      }
    } finally {
      this.abortController = null;
      this.emit({
        type: "agent.loop_complete",
        session_id: this.id,
        run_id: runId,
        stop_reason: stopReason,
        total_turns: turnCount,
        elapsed_ms: Date.now() - startTime,
        timestamp: nowIso(),
      });
    }

    // Plan-mode approval: after a clean plan-mode loop, ask the client.
    if (this.permMode === "plan" && stopReason === "end_turn") {
      await this.requestPlanApproval();
    }
  }

  private async requestPlanApproval(): Promise<void> {
    const planPath = getOrCreatePlanPath(this.workDir);
    let planContent = "";
    try {
      if (existsSync(planPath)) {
        planContent = readFileSync(planPath, "utf-8");
      }
    } catch {
      /* noop */
    }

    let choice: WirePlanChoice;
    let feedback = "";
    try {
      ({ choice, feedback } = await this.broker.requestPlanApproval(this, planContent));
    } catch {
      return; // cancelled (e.g. client disconnect)
    }

    if (choice === "yolo" || choice === "manual") {
      this.hasExitedPlanMode = true;
      this.permMode = choice === "yolo" ? "bypassPermissions" : this.prePlanMode;
      this.emitModeChanged();
      this.conv.addSystemReminder(buildPlanModeExitReminder(planPath, !!planContent));
      this.systemMessage(
        choice === "yolo"
          ? "Plan approved. Entered YOLO mode."
          : "Plan approved. Each edit requires confirmation.",
      );
      if (planContent) {
        this.startRun(`Execute this plan:\n\n${planContent}`);
      }
    } else if (choice === "feedback" && feedback) {
      this.startRun(feedback);
    }
  }

  private extractMemories(conv: ConversationManager): void {
    if (this.memExtracting) {
      return;
    }
    if (conv.len() - this.memCursor < 2) {
      return;
    }
    this.memExtracting = true;
    const cursor = conv.len();
    const summary = conv
      .getMessages()
      .slice(-40)
      .map((m) => `[${m.role}]: ${m.content}`)
      .filter((sm) => sm.length > 12)
      .join("\n");
    this.memExtractor ??= new MemoryExtractor(this.client, this.workDir);
    this.memExtractor
      .extract(summary)
      .then((saved) => {
        this.memCursor = cursor;
        if (saved.length > 0) {
          this.systemMessage(`Memory saved: ${saved.join(", ")}`);
        }
      })
      .catch((err: unknown) => {
        log.debug({ err }, "memory extraction failed");
      })
      .finally(() => {
        this.memExtracting = false;
      });

    // Background consolidation (fire-and-forget)
    new MemoryConsolidator(this.client, this.workDir, {
      appendSystem: (msg) => {
        conv.addSystemReminder(msg);
      },
    })
      .maybeRun()
      .catch(() => {
        /* non-fatal */
      });
  }

  private refreshSkillsIfNeeded(): void {
    const catalog = this.skillCatalog;
    if (!catalog?.needsReload()) {
      return;
    }
    catalog.reload();
    wireSkillsToRegistry(catalog, this.cmdRegistry, this.skillHost);
    const env = detectEnvironment(this.workDir);
    env.model = this.provider.model;
    const skillSection = buildSkillSection(catalog, this.workDir);
    this.client.setSystemPrompt(buildSystemPrompt(env, { skillSection }));
  }

  // -- Session resume -----------------------------------------------------------

  /** Rebuilds conversation from a persisted session; returns replay transcript. */
  resumeFrom(resumeId: string): { role: string; content: string }[] {
    const saved = sessionMod.loadSession(this.workDir, resumeId);
    if (saved.length === 0) {
      throw new Error(`Session "${resumeId}" not found or empty.`);
    }
    const conv = new ConversationManager();
    conv.injectLongTermMemory(this.ltmInstructions, this.ltmMemoryContent);
    const restored = sessionMod.rebuildFromSession(saved);
    for (const m of restored) {
      if (m.toolUses?.length) {
        conv.addAssistantMessageWithTools(
          m.content,
          m.toolUses.map((tu) => ({ ...tu, arguments: tu.arguments ?? {} })),
        );
      } else if (m.toolResults?.length) {
        conv.addToolResultsMessage(
          m.toolResults.map((tr) => ({ ...tr, isError: tr.isError ?? false })),
        );
      } else if (m.role === "user") {
        conv.addUserMessage(m.content);
      } else {
        conv.addAssistantMessage(m.content);
      }
    }
    this.conv = conv;
    // Continue persistence under the resumed larky session id.
    this.larkyId = resumeId;
    this.taskList.useStore(new TaskStore(this.workDir, resumeId));
    this.fileHistory = new FileHistory(this.workDir, resumeId);
    return restored
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      }));
  }

  // -- Rewind -------------------------------------------------------------------

  getSnapshots(): Snapshot[] {
    return this.fileHistory.getSnapshots();
  }

  rewind(index: number, mode: "both" | "files" | "conversation"): string {
    const snapshots = this.getSnapshots();
    const snap = snapshots[index];
    if (!snap) {
      throw new Error(`No snapshot at index ${String(index)}`);
    }
    if (mode === "conversation") {
      this.conv.truncateTo(snap.messageIndex);
      return "⟲ Rewound conversation. Files unchanged.";
    }
    const changed = this.fileHistory.rewind(index);
    if (mode === "both") {
      this.conv.truncateTo(snap.messageIndex);
    }
    const fileList = changed.length > 0 ? "\n" + changed.map((f) => "  " + f).join("\n") : "";
    return mode === "both"
      ? `⟲ Rewound to checkpoint. Restored ${String(changed.length)} file(s) and conversation.${fileList}`
      : `⟲ Restored ${String(changed.length)} file(s). Conversation unchanged.${fileList}`;
  }

  // -- Slash commands (daemon side) ----------------------------------------------

  listCommands(): { name: string; description: string }[] {
    return this.cmdRegistry.listCommands().map((c) => ({
      name: c.name,
      description: c.description,
    }));
  }

  /**
   * Executes a slash command daemon-side. Output arrives as system.message
   * events terminated by command.done; prompt commands start an agent run.
   * Client-side commands (quit, resume picker, rewind dialog) never reach here.
   */
  async runCommand(input: string): Promise<void> {
    let parsed = parseCommand(input);
    if (!parsed) {
      this.commandDone();
      return;
    }

    // /mcp — daemon-side MCP status
    if (parsed.name === "mcp") {
      if (!this.mcpInfo || this.mcpInfo.servers.length === 0) {
        this.systemMessage("No MCP servers connected.");
      } else {
        this.systemMessage(
          [
            `MCP servers (${String(this.mcpInfo.servers.length)}):`,
            ...this.mcpInfo.servers.map((sv) => `  · ${sv}`),
            `Tools: ${String(this.mcpInfo.toolCount)} total`,
          ].join("\n"),
        );
      }
      this.commandDone();
      return;
    }

    // `/skill <name> [args]` shorthand
    if (parsed.name === "skill" && parsed.args.trim()) {
      const parts = parsed.args.trim().split(/\s+/);
      parsed =
        parts[0] === "reload"
          ? { name: "skills", args: "reload" }
          : { name: parts[0], args: parts.slice(1).join(" ") };
    }

    const cmd = this.cmdRegistry.find(parsed.name);
    if (!cmd) {
      this.systemMessage(`Unknown command: /${parsed.name}`);
      this.commandDone();
      return;
    }

    // Rich status/permission/memory commands need live daemon state.
    if (cmd.name === "status") {
      const sbStatus = this.sandboxEnabled
        ? this.sandboxAutoAllow
          ? "ON (auto-allow)"
          : "ON (manual)"
        : "OFF";
      this.systemMessage(
        [
          `Mode:      ${this.permMode}`,
          `Model:     ${this.provider.model}`,
          `Provider:  ${this.provider.name} (${this.provider.protocol})`,
          `Tokens:    ${String(this.inputTokens)} in / ${String(this.outputTokens)} out`,
          `Tools:     ${String(this.registry.listTools().length)}`,
          `Sandbox:   ${sbStatus}`,
          `Memories:  ${String(this.memoryManager.getMemories().length)}`,
          `Skills:    ${String(this.skillCatalog?.list().length ?? 0)}`,
          `MCP:       ${String(this.mcpInfo?.servers.length ?? 0)} server(s), ${String(this.mcpInfo?.toolCount ?? 0)} tool(s)`,
          `Session:   ${this.larkyId}`,
          `Directory: ${this.workDir}`,
        ].join("\n"),
      );
      this.commandDone();
      return;
    }
    if (cmd.name === "permission") {
      const parts = parsed.args.trim().split(/\s+/);
      const modes: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];
      if (parts[0] === "mode" && parts[1]) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        if (modes.includes(parts[1] as PermissionMode)) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          this.setMode(parts[1] as PermissionMode);
          this.systemMessage(`Permission mode → ${parts[1]}`);
        } else {
          this.systemMessage(`Unknown mode '${parts[1]}'. Valid: ${modes.join(", ")}`);
        }
      } else {
        this.systemMessage(
          `Permission mode: ${this.permMode}\n` +
            "Change with shift+tab, or /permission mode <default|acceptEdits|plan|bypassPermissions>",
        );
      }
      this.commandDone();
      return;
    }
    if (cmd.name === "memory") {
      const sub = parsed.args.trim().split(/\s+/)[0];
      const mgr = new MemoryManager(this.workDir);
      if (sub === "clear") {
        mgr.clear();
        this.systemMessage("All memories cleared.");
      } else {
        const mems = mgr.getMemories();
        this.systemMessage(
          mems.length === 0
            ? "No memories saved yet. They are auto-extracted; /memory clear wipes them."
            : `Memories (${String(mems.length)}):\n` +
                mems.map((m) => `  [${m.type}] ${m.name} — ${m.description}`).join("\n"),
        );
      }
      this.commandDone();
      return;
    }

    switch (cmd.type) {
      case "local": {
        const output = cmd.handler(this.buildCommandContext(parsed.args));
        this.systemMessage(output);
        this.commandDone();
        return;
      }
      case "local_ui": {
        await this.runLocalUICommand(
          cmd.handler(this.buildCommandContext(parsed.args)),
          parsed.args,
        );
        return;
      }
      case "prompt": {
        const promptText = cmd.handler(this.buildCommandContext(parsed.args));
        this.commandDone();
        if (promptText.trim()) {
          const displayText = parsed.args ? `/${parsed.name} ${parsed.args}` : `/${parsed.name}`;
          this.startRun(promptText, { displayText });
        }
        return;
      }
      case "skill_fork": {
        await this.runSkillFork(parsed.name, parsed.args);
        return;
      }
    }
  }

  private buildCommandContext(args: string): CommandContext {
    return {
      workDir: this.workDir,
      args,
      permissionMode: () => this.permMode,
      tokenCount: () => [this.inputTokens, this.outputTokens] as const,
      toolCount: () => this.registry.listTools().length,
      memoryList: () => this.memoryManager.getMemories().map((m) => m.name),
      model: this.provider.model,
    };
  }

  private async runLocalUICommand(action: string, args: string): Promise<void> {
    switch (action) {
      case "clear": {
        this.conv = new ConversationManager();
        this.conv.injectLongTermMemory(this.ltmInstructions, this.ltmMemoryContent);
        this.larkyId = sessionMod.newSessionId();
        this.taskList.useStore(new TaskStore(this.workDir, this.larkyId));
        this.fileHistory = new FileHistory(this.workDir, this.larkyId);
        this.inputTokens = 0;
        this.outputTokens = 0;
        this.memCursor = 0;
        this.memExtracting = false;
        this.emit({
          type: "ui.clear",
          session_id: this.id,
          timestamp: nowIso(),
        });
        this.commandDone();
        break;
      }
      case "plan": {
        this.prePlanMode = this.permMode === "plan" ? this.prePlanMode : this.permMode;
        this.permMode = "plan";
        this.emitModeChanged();
        const planPath = getOrCreatePlanPath(this.workDir);
        this.systemMessage(
          `Entered plan mode (read-only). Plan file: ${planPath}\n` +
            "Investigate and design your approach. The agent will call ExitPlanMode when the plan is ready.",
        );
        if (this.hasExitedPlanMode && planExists(this.workDir)) {
          const reentryMsg = buildPlanModeReentryReminder(planPath, true);
          if (reentryMsg) {
            this.conv.addSystemReminder(reentryMsg);
            this.systemMessage(reentryMsg);
          }
          this.hasExitedPlanMode = false;
        }
        this.commandDone();
        break;
      }
      case "do": {
        this.permMode = "default";
        this.emitModeChanged();
        this.hasExitedPlanMode = true;
        const planContent = loadPlan();
        const exitPlanPath = getOrCreatePlanPath(this.workDir);
        this.conv.addSystemReminder(buildPlanModeExitReminder(exitPlanPath, !!planContent));
        if (planContent?.trim()) {
          resetPlanPath();
          this.systemMessage("✓ Plan approved — executing.");
          this.commandDone();
          this.startRun(
            "The plan below has been approved. Exit plan mode and carry it out now.\n\n# Approved Plan\n" +
              planContent,
            { skipUserMessage: false },
          );
        } else {
          this.systemMessage("Exited plan mode.");
          this.commandDone();
        }
        break;
      }
      case "compact": {
        this.systemMessage("Compacting conversation...");
        try {
          const result = await forceCompact(
            this.conv,
            this.client,
            this.recoveryState,
            this.registry.listTools().map((t) => t.name),
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            this.registry.getAllSchemas() as ToolSchema[],
            this.persist ? sessionMod.getSessionFilePath(this.workDir, this.larkyId) : undefined,
          );
          if (result.boundary && this.persist) {
            sessionMod.saveCompactBoundary(this.workDir, this.larkyId, result.boundary);
          }
          this.systemMessage(`Compact: ${result.message}`);
        } catch (err) {
          this.systemMessage(`Compact failed: ${asErrorString(err)}`);
        }
        this.commandDone();
        break;
      }
      case "resume": {
        // Argument-less /resume is intercepted client-side (picker); with an
        // argument the client calls session.resume — but keep a text fallback.
        const arg = args.trim();
        if (!arg) {
          const sessions = sessionMod.listSessions(this.workDir);
          this.systemMessage(
            sessions.length === 0
              ? "No sessions found."
              : "Sessions (use /resume <id> to restore):\n" +
                  sessions
                    .slice(0, 10)
                    .map(
                      (sn) => `  ${sn.id} (${String(sn.messageCount)} msgs) — ${sn.firstMessage}`,
                    )
                    .join("\n"),
          );
          this.commandDone();
          break;
        }
        try {
          const replay = this.resumeFrom(arg);
          this.emit({
            type: "ui.clear",
            session_id: this.id,
            timestamp: nowIso(),
          });
          for (const m of replay) {
            this.emit({
              type: "replay.message",
              session_id: this.id,
              role: m.role,
              content: m.content,
              timestamp: nowIso(),
            });
          }
          this.systemMessage(`⟲ Resumed session ${arg} (${String(replay.length)} messages).`);
        } catch (err) {
          this.systemMessage(asErrorString(err));
        }
        this.commandDone();
        break;
      }
      case "skills": {
        const catalog = this.skillCatalog;
        if (!catalog) {
          this.systemMessage("Skills: no catalog loaded.");
        } else if (args.trim() === "reload") {
          catalog.reload();
          wireSkillsToRegistry(catalog, this.cmdRegistry, this.skillHost);
          const env = detectEnvironment(this.workDir);
          env.model = this.provider.model;
          this.client.setSystemPrompt(
            buildSystemPrompt(env, {
              skillSection: buildSkillSection(catalog, this.workDir),
            }),
          );
          this.systemMessage(
            `Skills reloaded. ${String(catalog.list().length)} skill(s) available.`,
          );
        } else {
          const skills = catalog.list();
          this.systemMessage(
            skills.length === 0
              ? "No skills found in .larky/skills/."
              : `Available skills:\n${skills.map((sk) => `  /${sk.name} — ${sk.description}`).join("\n")}\n\nType /skills reload to hot-reload skills from disk.`,
          );
        }
        this.commandDone();
        break;
      }
      case "worktree": {
        try {
          const { execSync } = await import("node:child_process");
          const output = execSync("git worktree list", {
            cwd: this.workDir,
            encoding: "utf-8",
          });
          this.systemMessage(`Worktree list:\n${output}`);
        } catch {
          this.systemMessage("Not a git repository or git worktree not available.");
        }
        this.commandDone();
        break;
      }
      case "rewind": {
        // Interactive rewind is client-side (rewind.list / rewind.apply RPCs).
        if (!this.fileHistory.hasSnapshots()) {
          this.systemMessage("No checkpoints to rewind to.");
        } else {
          this.systemMessage("Use the rewind dialog (client) or rewind.list/rewind.apply RPCs.");
        }
        this.commandDone();
        break;
      }
      case "sandbox": {
        const arg = args.trim();
        const sbAvailable = (await this.sandboxPromise)?.available() ?? false;
        const note = sbAvailable ? "" : " (sandbox tool not found, wrapping disabled)";
        if (arg === "1" || arg === "on") {
          this.sandboxEnabled = true;
          this.sandboxAutoAllow = true;
          this.systemMessage(`Sandbox: ON + auto-allow${note}`);
        } else if (arg === "2" || arg === "manual") {
          this.sandboxEnabled = true;
          this.sandboxAutoAllow = false;
          this.systemMessage(`Sandbox: ON + manual permissions${note}`);
        } else if (arg === "3" || arg === "off") {
          this.sandboxEnabled = false;
          this.sandboxAutoAllow = false;
          this.systemMessage("Sandbox: OFF");
        } else {
          const status = this.sandboxEnabled
            ? this.sandboxAutoAllow
              ? "ON + auto-allow"
              : "ON + manual"
            : "OFF";
          this.systemMessage(
            [
              `Sandbox status: ${status}`,
              `Platform tool: ${sbAvailable ? "available" : "not found"}`,
              "",
              "Usage: /sandbox <mode>",
              "  1 (on)     — Enable sandbox + auto-allow (recommended)",
              "  2 (manual) — Enable sandbox + manual permission confirmation",
              "  3 (off)    — Disable sandbox",
            ].join("\n"),
          );
        }
        this.commandDone();
        break;
      }
      case "quit":
      default:
        // quit is client-side; unknown local_ui actions just complete.
        this.commandDone();
        break;
    }
  }

  private async runSkillFork(name: string, args: string): Promise<void> {
    const skill = this.skillCatalog?.get(name);
    if (!skill) {
      this.systemMessage(`Skill not found: ${name}`);
      this.commandDone();
      return;
    }
    this.systemMessage(`Running skill "${name}" in fork mode…`);
    const forkHost: SkillForkHost = {
      activateSkill: this.skillHost.activateSkill.bind(this.skillHost),
      runSubagent: (prompt: string) =>
        spawnSubagent(
          {
            name: skill.meta.name,
            description: skill.meta.description,
            model: skill.meta.model,
          },
          prompt,
          this.client,
          this.registry,
          this.provider,
          this.workDir,
        ),
      snapshotParentMessages: (count: number) => {
        return this.conv
          .getMessages()
          .slice(-count)
          .map((m) => `[${m.role}] ${m.content}`)
          .join("\n");
      },
    };
    try {
      const result = await runSkillFork(skill, args, forkHost);
      // Surface the fork result as a normal stream so clients render it as assistant output.
      this.emit({
        type: "agent.stream_text",
        session_id: this.id,
        run_id: "",
        text: result,
        timestamp: nowIso(),
      });
    } catch (err) {
      this.systemMessage(`Skill fork error: ${asErrorString(err)}`);
    }
    this.commandDone();
  }
}

// -- Shared helpers (mirrors larky tui/app.tsx module-level functions) ----------

export function wireSkillsToRegistry(
  catalog: SkillCatalog,
  cmdRegistry: CommandRegistry,
  skillHost: SkillHost,
): void {
  for (const meta of catalog.list()) {
    if (cmdRegistry.find(meta.name)) {
      continue;
    }
    const skill = catalog.get(meta.name);
    if (!skill) {
      continue;
    }
    const isFork = skill.meta.mode === "fork";
    try {
      cmdRegistry.register({
        name: meta.name,
        aliases: [],
        type: isFork ? "skill_fork" : "prompt",
        description: `${meta.description} [skill]`,
        handler: isFork ? () => "" : (ctx) => runSkillInline(skill, ctx.args, skillHost),
      });
    } catch {
      // name clash → keep existing command
    }
  }
}

export function buildSkillSection(catalog: SkillCatalog, workDir: string): string {
  const metas = catalog.list();
  if (metas.length === 0) {
    return "";
  }
  const skillsDir = join(workDir, ".larky", "skills");
  const lines = [
    "## Available Skills\n",
    `Skills are installed at: ${skillsDir}`,
    "When creating new skills, always place them under this directory as <skill-name>/SKILL.md.\n",
    'Only Skill names and one-line descriptions are listed below. To activate a Skill on demand call the LoadSkill tool with {name: "<skill-name>"}. After activation the Skill\'s full SOP gets pinned to the environment context, and any tools the Skill declares get registered. Users can also invoke a Skill directly with /<name>.\n',
    'If the user pastes a Skill URL (skills.sh, github.com tree URL, or raw SKILL.md URL) and asks to install / add / get it, call the InstallSkill tool with {url: "<url>"} — the new Skill becomes available immediately afterwards.\n',
  ];
  for (const meta of metas) {
    const desc =
      meta.description.length > 200 ? meta.description.slice(0, 200) + "…" : meta.description;
    lines.push(`- /${meta.name}: ${desc}`);
  }
  return lines.join("\n");
}
