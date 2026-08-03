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

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { Box, Static, Text, useApp, useInput } from "ink";
import { useState, useEffect, useRef, useCallback } from "react";

import { Agent } from "../agent/agent.js";
import {
  parse as parseCommand,
  createDefaultRegistry as createCommandRegistry,
  type CommandRegistry,
  type Command,
} from "../commands/commands.js";
import { loadUserCommands } from "../commands/loader.js";
import { CommandUsageTracker } from "../commands/usage-tracker.js";
import { forceCompact } from "../compact/compact.js";
import { RecoveryState } from "../compact/recovery.js";
import type {
  ProviderConfig,
  MCPServerConfig,
  HookConfig,
  SandboxYamlConfig,
} from "../config/config.js";
import { getContextWindow, getContextWindowAsync, getMaxOutputTokens } from "../config/config.js";
import { ConversationManager } from "../conversation/conversation.js";
import { FileHistory } from "../file-history/file-history.js";
import type { Snapshot } from "../file-history/file-history.js";
import * as historyMod from "../history/history.js";
import { HookEngine, validate as validateHooks } from "../hooks/hooks.js";
import type { LLMClient } from "../llm/client.js";
import { createClient } from "../llm/client.js";
import { MCPManager } from "../mcp/manager.js";
import { MCPToolWrapper } from "../mcp/tool-wrapper.js";
import { MemoryExtractor } from "../memory/extractor.js";
import { loadInstructions } from "../memory/instructions.js";
import { MemoryManager } from "../memory/manager.js";
import { PermissionChecker, type PermissionMode } from "../permissions/checker.js";
import {
  getOrCreatePlanPath,
  loadPlan,
  planExists,
  resetPlanPath,
} from "../plan-file/plan-file.js";
import { buildSystemPrompt, detectEnvironment } from "../prompt/builder.js";
import { buildPlanModeExitReminder, buildPlanModeReentryReminder } from "../prompt/plan-mode.js";
import { createSandbox, type Sandbox } from "../sandbox/index.js";
import * as sessionMod from "../session/session.js";
import { SkillCatalog } from "../skills/catalog.js";
import { runInline as runSkillInline, runFork as runSkillFork } from "../skills/executor.js";
import { InstallSkillTool } from "../skills/install-tool.js";
import { LoadSkillTool } from "../skills/load-skill-tool.js";
import type { SkillHost, SkillForkHost } from "../skills/skill.js";
import { AgentTool } from "../subagent/agent-tool.js";
import { BUILTIN_AGENTS } from "../subagent/definition.js";
import { spawnSubagent } from "../subagent/spawn.js";
import { coordinatorToolFilter, coordinatorActive } from "../teams/coordinator.js";
import type { TeammateUIState } from "../teams/progress.js";
import { TaskStopTool } from "../teams/task-stop.js";
import type { RunAgent } from "../teams/team.js";
import { TeamManager } from "../teams/team.js";
import {
  TeamCreateTool,
  SpawnTeammateTool,
  SendMessageTool,
  ListTeamsTool,
  TeamDeleteTool,
} from "../teams/tools.js";
import { TaskStore } from "../todo/store.js";
import { TaskList } from "../todo/todo.js";
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from "../todo/tools.js";
import { AskUserQuestionTool, type Question } from "../tools/ask-user.js";
import { BashTool } from "../tools/bash.js";
import { EditFileTool } from "../tools/edit-file.js";
import { EnterWorktreeTool } from "../tools/enter-worktree.js";
import { ExitPlanModeTool } from "../tools/exit-plan-mode.js";
import { ExitWorktreeTool } from "../tools/exit-worktree.js";
import { FileStateCache } from "../tools/file-state-cache.js";
import { GlobTool } from "../tools/glob.js";
import { GrepTool } from "../tools/grep.js";
import { ReadFileTool } from "../tools/read-file.js";
import { ToolRegistry } from "../tools/registry.js";
import { SyntheticOutputTool } from "../tools/synthetic-output.js";
import { ToolSearchTool } from "../tools/tool-search.js";
import { WriteFileTool } from "../tools/write-file.js";
import { connectToIde, type IdeConnection } from "../vscode/ide-client.js";

import { AskUserDialog } from "./ask-user-dialog.js";
import { expandAtRefsWithImages } from "./at-expand.js";
import { ChatView, CommittedMessage, type ChatMessage, type ToolSummaryItem } from "./chat.js";
import { InputBox } from "./input.js";
import { PermissionDialog, type PermissionAction } from "./permission-dialog.js";
import { PlanApprovalDialog, type PlanChoice } from "./plan-approval.js";
import { ProviderSelect } from "./provider-select.js";
import RewindDialog, { type RewindAction } from "./rewind-dialog.js";
import Spinner from "./spinner.js";
import { BORDER_COLORS, ICONS } from "./styles.js";
import { TeamStatus } from "./team-status.js";
import { TeammateSpinnerTree } from "./teammate-spinner-tree.js";
import { TeamsDialog } from "./teams-dialog.js";
import { ToolDisplay, type ToolBlockInfo } from "./tool-display.js";
import { randomCompletionVerb } from "./verbs.js";
import { version } from "./version.js";

import type { ToolSchema } from "@/tools/types.js";
import { asErrorString, asRecord, contentToText, strArg } from "@/utils/index.js";

type AppState = "providerSelect" | "chat";

interface Props {
  providers: ProviderConfig[];
  permissionMode?: string;
  mcpServers: MCPServerConfig[];
  hooks: HookConfig[];
  sandboxConfig?: SandboxYamlConfig;
  enableCoordinatorMode?: boolean;
  forkDisabled?: boolean;
}

function createToolRegistry(workDir: string, taskList: TaskList): ToolRegistry {
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
  registry.register(new TaskCreateTool(taskList));
  registry.register(new TaskGetTool(taskList));
  registry.register(new TaskListTool(taskList));
  registry.register(new TaskUpdateTool(taskList));
  return registry;
}

/**
 * wireSkillsToRegistry registers every loaded skill as a slash command in the
 * CommandRegistry, mirroring Go's wireSkillsToAgent. Inline skills become
 * "prompt" commands whose handler renders the skill body; fork-mode skills
 * become "skill_fork" commands (dispatched separately in executeCommand).
 *
 * Idempotent: silently skips a name that's already taken (e.g. a built-in or
 * user command registered earlier), matching Go's precedence rules.
 */
function wireSkillsToRegistry(
  catalog: SkillCatalog,
  cmdRegistry: CommandRegistry,
  skillHost: SkillHost,
): void {
  for (const meta of catalog.list()) {
    // Don't shadow existing built-in or user commands.
    if (cmdRegistry.find(meta.name)) {
      continue;
    }

    const skill = catalog.get(meta.name);
    if (!skill) {
      continue;
    }

    const isFork = skill.meta.mode === "fork";

    const cmd: Command = {
      name: meta.name,
      aliases: [],
      type: isFork ? "skill_fork" : "prompt",
      description: `${meta.description} [skill]`,
      handler: isFork
        ? () => "" // fork dispatch handled in executeCommand before handler
        : (ctx) => runSkillInline(skill, ctx.args, skillHost),
    };
    try {
      cmdRegistry.register(cmd);
    } catch {
      // name clash → keep the existing command
    }
  }
}

export function App({
  providers,
  permissionMode,
  mcpServers,
  hooks,
  sandboxConfig: sandboxYaml,
  enableCoordinatorMode,
  forkDisabled,
}: Props) {
  const { exit } = useApp();
  const [appState, setAppState] = useState<AppState>(
    providers.length === 1 ? "chat" : "providerSelect",
  );
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfig>(providers[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [completionMark, setCompletionMark] = useState<string | null>(null);
  const streamStartRef = useRef(0);
  const streamingTextRef = useRef("");
  const streamThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTools, setActiveTools] = useState<ToolBlockInfo[]>([]);
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const [permMode, setPermMode] = useState<PermissionMode>(() => {
    if (process.env.SWIFTY_BYPASS_PERMISSIONS === "1") {
      return "bypassPermissions";
    }
    const isPermissionMode = (mode: string): mode is PermissionMode =>
      ["default", "acceptEdits", "plan", "bypassPermissions"].includes(mode);
    if (permissionMode && isPermissionMode(permissionMode)) {
      return permissionMode;
    }
    return "default";
  });
  const [error, setError] = useState<string | null>(null);
  const [planApprovalActive, setPlanApprovalActive] = useState(false);
  const [prePlanMode, setPrePlanMode] = useState<PermissionMode>("default");
  // Tracks whether plan mode has been exited
  const hasExitedPlanModeRef = useRef(false);
  const permModeRef = useRef(permMode);
  useEffect(() => {
    permModeRef.current = permMode;
  }, [permMode]);
  const [mcpInfo, setMcpInfo] = useState<{
    servers: string[];
    toolCount: number;
  } | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  const workDir = process.cwd();
  const historyDir = `${workDir}/.swifty`;

  const clientRef = useRef<LLMClient | null>(null);
  // Resolved context window for the active provider. Seeded synchronously
  // (layers 1/3/4) and upgraded in initClient via the async auto-fetch (layer 2).
  const contextWindowRef = useRef(getContextWindow(providers[0]));
  const convRef = useRef(new ConversationManager());
  const sessionIdRef = useRef(sessionMod.newSessionId());
  const taskListRef = useRef(new TaskList(new TaskStore(workDir, sessionIdRef.current)));
  const registryRef = useRef(
    (() => {
      const reg = createToolRegistry(workDir, taskListRef.current);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const exitPlan = reg.get("ExitPlanMode") as ExitPlanModeTool | undefined;
      if (exitPlan) {
        exitPlan.isPlanMode = () => permModeRef.current === "plan";
        exitPlan.planExists = () => {
          const p = getOrCreatePlanPath(workDir);
          return existsSync(p);
        };
      }
      return reg;
    })(),
  );
  const cmdRegistryRef = useRef(createCommandRegistry());
  const usageTrackerRef = useRef(new CommandUsageTracker(workDir));
  const mcpManagerRef = useRef<MCPManager | null>(null);
  const hookEngineRef = useRef<HookEngine | null>(null);
  const skillCatalogRef = useRef<SkillCatalog | null>(null);
  // 已经告诉过模型的 Skill 名字。会话首条 system-reminder 带全量清单，
  // 之后只补新增的，避免重复占上下文。
  const announcedSkillsRef = useRef<Set<string>>(new Set());

  // 返回还没通知过模型的 Skill 清单，并记进 announcedSkillsRef。
  const skillDelta = (): string => {
    const catalog = skillCatalogRef.current;
    if (!catalog) {
      return "";
    }
    const lines: string[] = [];
    for (const meta of catalog.list()) {
      if (announcedSkillsRef.current.has(meta.name)) {
        continue;
      }
      announcedSkillsRef.current.add(meta.name);
      const desc =
        meta.description.length > 200 ? meta.description.slice(0, 200) + "…" : meta.description;
      lines.push(`- /${meta.name}: ${desc}`);
    }
    return lines.join("\n");
  };

  const recoveryStateRef = useRef(new RecoveryState());
  const memCursorRef = useRef(0);
  const memExtractingRef = useRef(false);
  const memExtractorRef = useRef<InstanceType<typeof MemoryExtractor> | null>(null);
  const memManagerRef = useRef<InstanceType<typeof MemoryManager> | null>(null);
  const activeSkillsRef = useRef(new Map<string, string>());
  const toolFilterRef = useRef<((name: string) => boolean) | null>(null);
  const skillHostRef = useRef<SkillHost>({
    activateSkill: (name, body) => activeSkillsRef.current.set(name, body),
  });
  const teamManagerRef = useRef(new TeamManager(workDir));
  const fileHistoryRef = useRef<FileHistory | null>(null);
  const fileStateCacheRef = useRef(new FileStateCache());
  const sandboxRef = useRef<Promise<Sandbox | null>>(createSandbox());
  const [sandboxEnabled, setSandboxEnabled] = useState(sandboxYaml?.enabled ?? false);
  const [sandboxAutoAllow, setSandboxAutoAllow] = useState(sandboxYaml?.auto_allow ?? false);
  const sandboxEnabledRef = useRef(sandboxYaml?.enabled ?? false);
  const sandboxAutoAllowRef = useRef(sandboxYaml?.auto_allow ?? false);
  const sandboxNetworkEnabled = sandboxYaml?.network_enabled ?? true;
  useEffect(() => {
    sandboxEnabledRef.current = sandboxEnabled;
  }, [sandboxEnabled]);
  useEffect(() => {
    sandboxAutoAllowRef.current = sandboxAutoAllow;
  }, [sandboxAutoAllow]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const permissionResolveRef = useRef<((v: "allow" | "deny" | "allowAlways") => void) | null>(null);
  const [rewindDialogActive, setRewindDialogActive] = useState(false);
  const [rewindSnapshots, setRewindSnapshots] = useState<Snapshot[]>([]);
  const [permissionRequest, setPermissionRequest] = useState<{
    toolName: string;
    argsSummary: string;
    reason: string;
  } | null>(null);
  const [askRequest, setAskRequest] = useState<Question[] | null>(null);
  const askResolveRef = useRef<((a: Record<string, string>) => void) | null>(null);
  const [teammateStates, setTeammateStates] = useState<TeammateUIState[]>([]);
  const [teamsDialogOpen, setTeamsDialogOpen] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [subagents, setSubagents] = useState<
    { id: number; label: string; turn: number; lastTool?: string }[]
  >([]);
  const subagentIdRef = useRef(0);

  // Poll teammate states from TeamManager every 500ms for live progress.
  useEffect(() => {
    const timer = setInterval(() => {
      const states = teamManagerRef.current.getAllTeammateStates();
      setTeammateStates(states);
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // VSCode integration: connect to the Claude Code extension's MCP server so
  // Cmd+Option+K in the editor inserts @file#Lx-y references into the input.
  const insertInputTextRef = useRef<((text: string) => void) | null>(null);
  useEffect(() => {
    let conn: IdeConnection | null = null;
    let cancelled = false;
    void connectToIde({
      cwd: workDir,
      onAtMentioned: ({ filePath, lineStart, lineEnd }) => {
        const rel = relative(workDir, filePath);
        const shown = rel && !rel.startsWith("..") ? rel : filePath;
        let mention = `@${shown}`;
        if (lineStart !== undefined) {
          mention += `#L${String(lineStart)}`;
          if (lineEnd !== undefined && lineEnd !== lineStart) {
            mention += `-${String(lineEnd)}`;
          }
        }
        insertInputTextRef.current?.(mention + " ");
      },
    }).then((c) => {
      if (!c) {
        return;
      }
      if (cancelled) {
        void c.close();
        return;
      }
      conn = c;
    });
    return () => {
      cancelled = true;
      void conn?.close();
    };
  }, [workDir]);

  // Mode cycling logic for InputBox useInput (input.tsx),
  // app raw stdin listener.

  // ctrl+c: interrupt streaming or exit app
  const ctrlCCountRef = useRef(0);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ctrlCHint, setCtrlCHint] = useState(false);
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (isStreaming && abortControllerRef.current) {
        abortControllerRef.current.abort();
        ctrlCCountRef.current = 0;
        return;
      }
      ctrlCCountRef.current += 1;
      if (ctrlCCountRef.current >= 2) {
        exit();
        return;
      }
      // First press shows hint; exit after 2 consecutive presses
      setCtrlCHint(true);
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
      }
      ctrlCTimerRef.current = setTimeout(() => {
        ctrlCCountRef.current = 0;
        setCtrlCHint(false);
      }, 2000);
    }
  });

  // ctrl+o toggles full vs. truncated tool output in the transcript.
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setToolsExpanded((e) => !e);
    }
  });

  // ctrl+t toggles the Teams dialog overlay.
  useInput(
    (input, key) => {
      if (key.ctrl && input === "t" && !isStreaming) {
        setTeamsDialogOpen((prev) => !prev);
      }
    },
    { isActive: !teamsDialogOpen },
  );

  const initClient = useCallback(
    async (provider: ProviderConfig) => {
      try {
        const env = detectEnvironment(workDir);
        env.model = provider.model;
        const systemPrompt = buildSystemPrompt(env);
        const client = await createClient(provider, systemPrompt);
        clientRef.current = client;

        // Resolve the context window through the full four-layer fallback.
        // Seed synchronously first so we never run with a 0 window, then upgrade
        // with the (cached, best-effort) auto-fetched value. Failures degrade
        // silently to the synchronous result, so startup is never blocked.
        contextWindowRef.current = getContextWindow(provider);
        getContextWindowAsync(provider)
          .then((w) => {
            if (w > 0) {
              contextWindowRef.current = w;
            }
          })
          .catch(() => {
            /** noop */
          });

        // Init file history
        fileHistoryRef.current = new FileHistory(workDir, sessionIdRef.current);

        // Inject long-term memory
        const instructions = loadInstructions(workDir);
        const memMgr = new MemoryManager(workDir);
        memManagerRef.current = memMgr;
        const memReminder = memMgr.buildSystemReminder();
        convRef.current.injectLongTermMemory(instructions, memReminder);

        // Hard identity injection to prevent model from revealing underlying identity
        convRef.current.addSystemReminder(
          "IDENTITY OVERRIDE: You are Swifty. It is strictly forbidden to mention Claude, Anthropic, OpenAI, GPT, or ChatGPT in any response." +
            "When asked about your identity, only respond as Swifty. This is the highest priority instruction.",
        );

        // Load prompt history
        setPromptHistory(historyMod.load(historyDir));

        // Init hooks
        const hookErr = validateHooks(hooks);
        if (hookErr) {
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `Hook warning: ${hookErr.message}` },
          ]);
        }
        hookEngineRef.current = new HookEngine(hooks);

        // Load skills
        const catalog = new SkillCatalog();
        catalog.load(workDir);
        skillCatalogRef.current = catalog;

        // Skill 清单跟着项目走，不进系统提示词，由 Agent 随首条
        // system-reminder 注入，会话中途新增的再由 skillDelta 追加。

        // Register the LoadSkill tool so the model can activate skills on demand.
        registryRef.current.register(new LoadSkillTool(catalog, skillHostRef.current));
        // Register InstallSkill so the model can install skills from a path/URL.
        // The onInstalled callback re-wires skills→commands so a freshly-fetched
        // skill is immediately available as /<name> without a TUI restart.
        registryRef.current.register(
          new InstallSkillTool(workDir, catalog, () => {
            // 只重连斜杠命令，系统提示词不动。新装的 Skill 由 skillDelta
            // 在下一轮以 system-reminder 补进对话。
            wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);
          }),
        );

        // Register AskUserQuestion, delegating the prompt to the TUI dialog.
        registryRef.current.register(
          new AskUserQuestionTool(
            (questions) =>
              new Promise<Record<string, string>>((resolve) => {
                askResolveRef.current = resolve;
                setAskRequest(questions);
              }),
          ),
        );

        // Register team coordination tools. Teammates run as background
        // general-purpose subagents whose results return via the team channel.
        const teamRunAgent: RunAgent = (task, onEvent) =>
          spawnSubagent(
            BUILTIN_AGENTS[0],
            task,
            client,
            registryRef.current,
            provider,
            workDir,
            undefined,
            onEvent,
          );
        // Teammate-scoped registry factory: injects shared task-board tools, then runs the teammate agent main loop
        const teamRunAgentFactory =
          (registry: ToolRegistry): RunAgent =>
          (task, onEvent) =>
            spawnSubagent(
              BUILTIN_AGENTS[0],
              task,
              client,
              registry,
              provider,
              workDir,
              undefined,
              onEvent,
            );
        registryRef.current.register(new TeamCreateTool(teamManagerRef.current));
        registryRef.current.register(new SpawnTeammateTool(teamManagerRef.current, teamRunAgent));
        registryRef.current.register(new SendMessageTool(teamManagerRef.current));
        registryRef.current.register(new ListTeamsTool(teamManagerRef.current));
        registryRef.current.register(new TeamDeleteTool(teamManagerRef.current));
        registryRef.current.register(new TaskStopTool(teamManagerRef.current));
        registryRef.current.register(new SyntheticOutputTool());

        // Load user-defined slash commands from .swifty/commands/*.md.
        for (const cmd of loadUserCommands(workDir)) {
          try {
            cmdRegistryRef.current.register(cmd);
          } catch {
            // name clash with a built-in command → keep the built-in
          }
        }

        // Wire every loaded skill as a slash command (inline → "prompt",
        // fork → "skill_fork"). Runs after user commands so user *.md files
        // take precedence. Idempotent: skips names already taken.
        wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);

        // Register AgentTool with real spawn + live progress reporting.
        const agentTool = new AgentTool(
          workDir,
          registryRef.current,
          async (def, prompt, _bg, modelOverride?, workDirOverride?) => {
            const id = ++subagentIdRef.current;
            setSubagents((prev) => [...prev, { id, label: def.name, turn: 0 }]);
            const onProgress = (p: { turn?: number; lastTool?: string }) => {
              setSubagents((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
            };
            try {
              return await spawnSubagent(
                def,
                prompt,
                client,
                registryRef.current,
                provider,
                workDirOverride ?? workDir,
                onProgress,
                undefined,
                modelOverride,
              );
            } finally {
              setSubagents((prev) => prev.filter((s) => s.id !== id));
            }
          },
        );
        agentTool.forkDisabled = forkDisabled ?? false;
        // Wire the team manager into AgentTool to enable the team_name teammate path (teammates receive shared task-board tools)
        agentTool.setTeamManager(teamManagerRef.current, teamRunAgentFactory);
        registryRef.current.register(agentTool);

        // Connect MCP servers in background
        if (mcpServers.length > 0) {
          const mgr = new MCPManager();
          mcpManagerRef.current = mgr;
          void mgr.connectAll(mcpServers).then((result) => {
            for (const { serverName, tool } of result.tools) {
              const client = mgr.getClient(serverName);
              if (client) {
                registryRef.current.register(new MCPToolWrapper(client, serverName, tool));
              }
            }
            if (result.errors.length > 0) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `MCP errors: ${result.errors.map((e) => `${e.serverName}: ${e.error}`).join("; ")}`,
                },
              ]);
            }
            if (result.servers.length > 0) {
              setMcpInfo({
                servers: result.servers,
                toolCount: result.tools.length,
              });
            }
            // Inject each server's instructions into the conversation so the
            // model knows how to use that server's tools. Mirrors Go.
            for (const { serverName, text } of result.instructions) {
              convRef.current.addSystemReminder(`# MCP Server: ${serverName}\n${text}`);
            }
          });
        }
      } catch (err) {
        setError(`Failed to init LLM client: ${asErrorString(err)}`);
      }
    },
    [workDir, mcpServers],
  );

  useEffect(() => {
    if (appState === "chat" && !clientRef.current) {
      void initClient(selectedProvider);
    }
  }, [appState, selectedProvider, initClient]);

  const handleProviderSelect = (provider: ProviderConfig) => {
    setSelectedProvider(provider);
    setAppState("chat");
  };

  const handleSlashCommand = async (text: string): Promise<boolean> => {
    let parsed = parseCommand(text);
    if (!parsed) {
      return false;
    }

    // /mcp — show MCP server status
    if (parsed.name === "mcp") {
      if (!mcpInfo || mcpInfo.servers.length === 0) {
        setMessages((prev) => [...prev, { role: "system", content: "No MCP servers connected." }]);
      } else {
        const lines = [
          `MCP servers (${String(mcpInfo.servers.length)}):`,
          ...mcpInfo.servers.map((s) => `  · ${s}`),
          `Tools: ${String(mcpInfo.toolCount)} total`,
        ];
        setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
      }
      usageTrackerRef.current.record("mcp");
      return true;
    }

    // `/skill <name> [args]` shorthand: rewrite to `/<name> [args]` so it
    // goes through the normal command registry path (skills are wired there).
    // Exception: `/skill reload` routes to the /skills handler instead.
    if (parsed.name === "skill" && parsed.args.trim()) {
      const parts = parsed.args.trim().split(/\s+/);
      if (parts[0] === "reload") {
        parsed = { name: "skills", args: "reload" };
      } else {
        parsed = { name: parts[0], args: parts.slice(1).join(" ") };
      }
    }

    const cmd = cmdRegistryRef.current.find(parsed.name);
    if (cmd) {
      usageTrackerRef.current.record(cmd.name);
    }
    if (!cmd) {
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `Unknown command: /${parsed.name}` },
      ]);
      return true;
    }

    // Rich status/memory commands need live app state, so handle them here.
    if (cmd.name === "status") {
      const sbStatus = sandboxEnabled
        ? sandboxAutoAllow
          ? "ON (auto-allow)"
          : "ON (manual)"
        : "OFF";
      const lines = [
        `Mode:      ${permMode}`,
        `Model:     ${selectedProvider.model}`,
        `Provider:  ${selectedProvider.name} (${selectedProvider.protocol})`,
        `Tokens:    ${String(inputTokens)} in / ${String(outputTokens)} out`,
        `Tools:     ${String(registryRef.current.listTools().length)}`,
        `Sandbox:   ${sbStatus}`,
        `Memories:  ${String(new MemoryManager(workDir).getMemories().length)}`,
        `Skills:    ${String(skillCatalogRef.current?.list().length ?? 0)}`,
        `MCP:       ${String(mcpInfo?.servers.length ?? 0)} server(s), ${String(mcpInfo?.toolCount ?? 0)} tool(s)`,
        `Session:   ${sessionIdRef.current}`,
        `Directory: ${workDir}`,
      ];
      setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
      return true;
    }
    if (cmd.name === "memory") {
      const sub = parsed.args.trim().split(/\s+/)[0];
      const mgr = new MemoryManager(workDir);
      if (sub === "clear") {
        mgr.clear();
        setMessages((prev) => [...prev, { role: "system", content: "All memories cleared." }]);
      } else {
        const mems = mgr.getMemories();
        const body =
          mems.length === 0
            ? "No memories saved yet. They are auto-extracted; /memory clear wipes them."
            : `Memories (${String(mems.length)}):\n` +
              mems.map((m) => `  [${m.type}] ${m.name} — ${m.description}`).join("\n");
        setMessages((prev) => [...prev, { role: "system", content: body }]);
      }
      return true;
    }

    if (cmd.type === "local_ui") {
      const action = cmd.handler({ workDir, args: parsed.args });
      switch (action) {
        case "clear": {
          // Clear messages and start a fresh conversation
          setMessages([]);
          convRef.current = new ConversationManager();
          // Reset the session ID and the stores derived from it
          sessionIdRef.current = sessionMod.newSessionId();
          taskListRef.current.useStore(new TaskStore(workDir, sessionIdRef.current));
          fileHistoryRef.current = new FileHistory(workDir, sessionIdRef.current);
          // Reset token counters
          setInputTokens(0);
          setOutputTokens(0);
          // Reset memory extraction state
          memCursorRef.current = 0;
          memExtractingRef.current = false;
          // Clear both the visible screen and terminal scrollback. Changing the
          // session ID remounts the static brand block on the next render.
          process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
          break;
        }
        case "quit":
          exit();
          break;
        case "plan": {
          setPrePlanMode(permMode);
          setPermMode("plan");
          const planPath = getOrCreatePlanPath(workDir);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content:
                `Entered plan mode (read-only). Plan file: ${planPath}\n` +
                "Investigate and design your approach. The agent will call ExitPlanMode when the plan is ready.",
            },
          ]);
          // Re-enter plan mode: if a plan file already exists, rebuild the reminder
          if (hasExitedPlanModeRef.current && planExists(workDir)) {
            const reentryMsg = buildPlanModeReentryReminder(planPath, true);
            if (reentryMsg) {
              convRef.current.addSystemReminder(reentryMsg);
              setMessages((prev) => [...prev, { role: "system", content: reentryMsg }]);
            }
            hasExitedPlanModeRef.current = false;
          }
          break;
        }
        case "do": {
          setPermMode("default");
          // Exit plan mode for manual approval
          hasExitedPlanModeRef.current = true;
          const planContent = loadPlan(/** workDir */);
          const exitPlanPath = getOrCreatePlanPath(workDir);
          convRef.current.addSystemReminder(buildPlanModeExitReminder(exitPlanPath, !!planContent));
          if (planContent?.trim()) {
            // Feed the approved plan back to the agent and execute it.
            convRef.current.addUserMessage(
              "The plan below has been approved. Exit plan mode and carry it out now.\n\n" +
                "# Approved Plan\n" +
                planContent,
            );
            resetPlanPath();
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "✓ Plan approved — executing." },
            ]);
            void runAgentLoop("default");
          } else {
            setMessages((prev) => [...prev, { role: "system", content: "Exited plan mode." }]);
          }
          break;
        }
        case "compact":
          if (clientRef.current) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "Compacting conversation..." },
            ]);
            forceCompact(
              convRef.current,
              clientRef.current,
              recoveryStateRef.current,
              registryRef.current.listTools().map((t) => t.name),
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              registryRef.current.getAllSchemas() as ToolSchema[],
              sessionMod.getSessionFilePath(workDir, sessionIdRef.current),
            )
              .then((result) => {
                // Persist the boundary so the compacted state survives /resume.
                if (result.boundary) {
                  sessionMod.saveCompactBoundary(workDir, sessionIdRef.current, result.boundary);
                }
                setMessages((prev) => [
                  ...prev,
                  { role: "system", content: `Compact: ${result.message}` },
                ]);
              })
              .catch((err: unknown) => {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "system",
                    content: `Compact failed: ${asErrorString(err)}`,
                  },
                ]);
              });
          }
          break;
        case "resume": {
          const arg = parsed.args.trim();
          if (!arg) {
            const sessions = sessionMod.listSessions(workDir);
            if (sessions.length === 0) {
              setMessages((prev) => [...prev, { role: "system", content: "No sessions found." }]);
            } else {
              const list = sessions
                .slice(0, 10)
                .map((s) => `  ${s.id} (${String(s.messageCount)} msgs) — ${s.firstMessage}`)
                .join("\n");
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Sessions (use /resume <id> to restore):\n${list}`,
                },
              ]);
            }
            break;
          }

          const saved = sessionMod.loadSession(workDir, arg);
          if (saved.length === 0) {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Session "${arg}" not found or empty.`,
              },
            ]);
            break;
          }

          // Rebuild the conversation (with long-term memory re-injected) and the
          // visible transcript from the saved messages, then continue under the
          // resumed session id. rebuildFromSession honors compaction: if the
          // session contains a compact_boundary it replays the compacted state
          // (summary + inlined keep + post-boundary appends) instead of the full
          // pre-boundary history; with no boundary it replays everything.
          const conv = new ConversationManager();
          conv.injectLongTermMemory(
            loadInstructions(workDir),
            new MemoryManager(workDir).buildSystemReminder(),
          );
          const restored = sessionMod.rebuildFromSession(saved);
          for (const m of restored) {
            // Tool blocks must be restored as well; otherwise the recovered
            // history is missing its call chain and the model can't see what was done before
            if (m.toolUses?.length) {
              conv.addAssistantMessageWithTools(
                contentToText(m.content),
                m.toolUses.map((tu) => ({
                  ...tu,
                  arguments: tu.arguments ?? {},
                })),
              );
            } else if (m.toolResults?.length) {
              conv.addToolResultsMessage(
                m.toolResults.map((tr) => ({
                  toolUseId: tr.toolUseId,
                  content: tr.content,
                  isError: tr.isError ?? false,
                })),
              );
            } else if (m.role === "user") {
              conv.addUserMessage(m.content);
            } else {
              conv.addAssistantMessage(contentToText(m.content));
            }
          }
          convRef.current = conv;
          sessionIdRef.current = arg;
          // Reload the task list for the resumed session.
          taskListRef.current.useStore(new TaskStore(workDir, arg));
          const resumedMessages: ChatMessage[] = [
            ...restored.map((m) => ({ ...m, content: contentToText(m.content) })),
            {
              role: "system",
              content: `⟲ Resumed session ${arg} (${String(restored.length)} messages).`,
            },
          ];
          setMessages(resumedMessages);
          break;
        }
        case "skills": {
          const catalog = skillCatalogRef.current;
          if (!catalog) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "Skills: no catalog loaded." },
            ]);
          } else if (parsed.args.trim() === "reload") {
            // /skills reload — hot-reload the catalog from disk
            catalog.reload();
            wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);
            // 系统提示词不动，新增的 Skill 走 skillDelta 下一轮补发
            const count = catalog.list().length;
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Skills reloaded. ${String(count)} skill(s) available.`,
              },
            ]);
          } else {
            const skills = catalog.list();
            if (skills.length === 0) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: "No skills found in .swifty/skills/.",
                },
              ]);
            } else {
              const list = skills.map((s) => `  /${s.name} — ${s.description}`).join("\n");
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Available skills:\n${list}\n\nType /skills reload to hot-reload skills from disk.`,
                },
              ]);
            }
          }
          break;
        }
        case "worktree": {
          try {
            const { execSync } = await import("node:child_process");
            const output = execSync("git worktree list", {
              cwd: workDir,
              encoding: "utf-8",
            });
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Worktree list:\n${output}` },
            ]);
          } catch {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: "Not a git repository or git worktree not available.",
              },
            ]);
          }
          break;
        }
        case "rewind": {
          const fh = fileHistoryRef.current;
          if (!fh?.hasSnapshots()) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "No checkpoints to rewind to." },
            ]);
          } else {
            setRewindSnapshots(fh.getSnapshots());
            setRewindDialogActive(true);
          }
          break;
        }
        case "sandbox": {
          const arg = parsed.args.trim();
          const sbAvailable = (await sandboxRef.current)?.available() ?? false;
          if (arg === "1" || arg === "on") {
            // Mode 1: enable sandbox + auto-allow
            setSandboxEnabled(true);
            setSandboxAutoAllow(true);
            sandboxEnabledRef.current = true;
            sandboxAutoAllowRef.current = true;
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Sandbox: ON + auto-allow${sbAvailable ? "" : " (sandbox tool not found, wrapping disabled)"}`,
              },
            ]);
          } else if (arg === "2" || arg === "manual") {
            // Mode 2: enable sandbox + manual permission confirmation
            setSandboxEnabled(true);
            setSandboxAutoAllow(false);
            sandboxEnabledRef.current = true;
            sandboxAutoAllowRef.current = false;
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Sandbox: ON + manual permissions${sbAvailable ? "" : " (sandbox tool not found, wrapping disabled)"}`,
              },
            ]);
          } else if (arg === "3" || arg === "off") {
            // Mode 3: disable sandbox
            setSandboxEnabled(false);
            setSandboxAutoAllow(false);
            sandboxEnabledRef.current = false;
            sandboxAutoAllowRef.current = false;
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: "Sandbox: OFF",
              },
            ]);
          } else {
            // No/unknown argument: show current status and usage
            const status = sandboxEnabled
              ? sandboxAutoAllow
                ? "ON + auto-allow"
                : "ON + manual"
              : "OFF";
            const lines = [
              `Sandbox status: ${status}`,
              `Platform tool: ${sbAvailable ? "available" : "not found"}`,
              "",
              "Usage: /sandbox <mode>",
              "  1 (on)     — Enable sandbox + auto-allow (recommended)",
              "  2 (manual) — Enable sandbox + manual permission confirmation",
              "  3 (off)    — Disable sandbox",
            ];
            setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
          }
          break;
        }
      }
      return true;
    }

    if (cmd.type === "local") {
      const output = cmd.handler({ workDir, args: parsed.args });
      setMessages((prev) => [...prev, { role: "system", content: output }]);
      return true;
    }

    if (cmd.type === "prompt") {
      // File-based custom command or inline skill: render the body and run it as a user turn.
      const promptText = cmd.handler({ workDir, args: parsed.args });
      if (clientRef.current && promptText.trim()) {
        setMessages((prev) => [...prev, { role: "user", content: promptText }]);
        convRef.current.addUserMessage(promptText);
        sessionMod.saveMessage(workDir, sessionIdRef.current, {
          role: "user",
          content: promptText,
          timestamp: Math.floor(Date.now() / 1000),
        });
        setIsStreaming(true);
        setStreamingText("");
        runAgentLoop()
          .then(() => {
            setIsStreaming(false);
            setActiveTools([]);
          })
          .catch((err: unknown) => {
            setError(asErrorString(err));
            setIsStreaming(false);
          });
      }
      return true;
    }

    if (cmd.type === "skill_fork") {
      const skill = skillCatalogRef.current?.get(parsed.name);
      if (!skill) {
        setMessages((prev) => [
          ...prev,
          { role: "system", content: `Skill not found: ${parsed.name}` },
        ]);
        return true;
      }
      const client = clientRef.current;
      if (!client) {
        setMessages((prev) => [...prev, { role: "system", content: "Client not ready." }]);
        return true;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Running skill "${parsed.name}" in fork mode…`,
        },
      ]);
      // Build a SkillForkHost backed by the live refs.
      const forkHost: SkillForkHost = {
        ...skillHostRef.current,
        runSubagent: (prompt: string) =>
          spawnSubagent(
            {
              name: skill.meta.name,
              description: skill.meta.description,
              model: skill.meta.model,
            },
            prompt,
            client,
            registryRef.current,
            selectedProvider,
            workDir,
          ),
        snapshotParentMessages: (count) => {
          const msgs = convRef.current.getMessages();
          return msgs
            .slice(-count)
            .map((m) => `[${m.role}] ${contentToText(m.content)}`)
            .join("\n");
        },
      };
      runSkillFork(skill, parsed.args, forkHost)
        .then((result) => {
          setMessages((prev) => [...prev, { role: "assistant", content: result }]);
        })
        .catch((err: unknown) => {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `Skill fork error: ${asErrorString(err)}`,
            },
          ]);
        });
      return true;
    }

    return false;
  };

  const formatToolArgs = (args: Record<string, unknown>): string => {
    if (args.command) {
      return truncate(strArg(args, "command"), 80);
    }
    if (args.file_path) {
      return truncate(strArg(args, "file_path"), 80);
    }
    if (args.pattern) {
      return truncate(strArg(args, "pattern"), 80);
    }
    return "";
  };

  const truncate = (s: string, max: number): string => (s.length > max ? s.slice(0, max) + "…" : s);

  const runAgentLoop = async (modeOverride?: PermissionMode) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // modeOverride avoids a stale-closure read of permMode right after a
    // setPermMode call (e.g. plan approval switching out of plan mode in the same tick).
    const checker = new PermissionChecker(workDir, modeOverride ?? permMode);
    // Propagate the current sandbox settings to the permission checker
    checker.sandboxEnabled = sandboxEnabledRef.current;
    checker.sandboxAutoAllow = sandboxAutoAllowRef.current;

    // Attach the sandbox to the BashTool when sandboxing is enabled
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const bashTool = registryRef.current.get("Bash") as BashTool | undefined;
    if (bashTool && sandboxEnabledRef.current) {
      bashTool.sandbox = await sandboxRef.current;
      bashTool.sandboxConfig = {
        allowWrite: [workDir, "/tmp"],
        denyWrite: [
          join(workDir, ".swifty", "config.yaml"),
          join(workDir, ".swifty", "permissions.local.yaml"),
          join(workDir, ".swifty", "skills"),
        ],
        networkEnabled: sandboxNetworkEnabled,
      };
    } else if (bashTool) {
      bashTool.sandbox = null;
    }
    // Memory recall: query relevant memories and provide context to LLM
    const recallPromise =
      memManagerRef.current && clientRef.current
        ? memManagerRef.current
            .findRelevantMemories(
              contentToText(
                convRef.current
                  .getMessages()
                  .filter((m) => m.role === "user")
                  .pop()?.content ?? "",
              ),
              clientRef.current,
            )
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
            .catch(() => "")
        : undefined;

    if (!clientRef.current) {
      return;
    }

    const agent = new Agent({
      client: clientRef.current,
      registry: registryRef.current,
      checker,
      conversation: convRef.current,
      workDir,
      sessionId: sessionIdRef.current,
      hookEngine: hookEngineRef.current ?? undefined,
      fileHistory: fileHistoryRef.current ?? undefined,
      fileStateCache: fileStateCacheRef.current,
      abortSignal: controller.signal,
      contextWindow: contextWindowRef.current,
      maxOutput: getMaxOutputTokens(selectedProvider),
      recoveryState: recoveryStateRef.current,
      activeSkills: activeSkillsRef.current,
      // 首条 system-reminder 带全量 Skill 清单，之后只补新增的
      skillSection: skillDelta(),
      skillDeltaFn: skillDelta,
      memoryRecallPromise: recallPromise,
      toolFilter: buildComposedToolFilter(
        coordinatorToolFilter(enableCoordinatorMode ?? false),
        toolFilterRef.current,
      ),
      coordinatorActiveFn: () => coordinatorActive(enableCoordinatorMode ?? false),
      // Surface teammate results (from team lead mailboxes) as reminders.
      notificationFn: () => teamManagerRef.current.drainLeads(),
      onLoopComplete: (conv) => {
        const client = clientRef.current;
        if (!client || memExtractingRef.current) {
          return;
        }
        if (conv.len() - memCursorRef.current < 2) {
          return;
        }
        memExtractingRef.current = true;
        const cursor = conv.len();
        const summary = conv
          .getMessages()
          .slice(-40)
          .map((m) => `[${m.role}]: ${contentToText(m.content)}`)
          .filter((s) => s.length > 12)
          .join("\n");
        // Lazy-init the Memory Extractor (one per session, reused across turns)
        memExtractorRef.current ??= new MemoryExtractor(client, workDir);
        memExtractorRef.current
          .extract(summary)
          .then((saved) => {
            memCursorRef.current = cursor;
            if (saved.length > 0) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Memory saved: ${saved.join(", ")}`,
                },
              ]);
            }
          })
          .catch((err: unknown) => {
            // Suppress logging in production; debug via memory-extractor logs
            console.error("[memory-extractor]", asErrorString(err));
          })
          .finally(() => {
            memExtractingRef.current = false;
          });
      },
      onPermissionRequest: async (toolName, args, decision) => {
        return new Promise<"allow" | "deny" | "allowAlways">((resolve) => {
          permissionResolveRef.current = resolve;
          setPermissionRequest({
            toolName,
            argsSummary: formatToolArgs(args),
            reason: decision.reason,
          });
        });
      },
    });

    let fullText = "";

    // Per-turn accumulators for the folded turn_summary display.
    let turnThinkingText = "";
    let turnThinkingStart = 0;
    let turnThinkingDuration = 0;
    let turnToolCalls: ToolSummaryItem[] = [];
    // Indices of in-flight tool_use messages added during the current turn.
    // These are removed when the turn completes and replaced by a single
    // turn_summary message.

    // let turnToolUseIndices: number[] = [];
    // Map toolName+toolId -> argsSummary so tool_result can look it up
    // (the agent's tool_result event doesn't carry args).
    const pendingToolArgs = new Map<string, string>();

    const resetTurnAccumulators = () => {
      turnThinkingText = "";
      turnThinkingStart = 0;
      turnThinkingDuration = 0;
      turnToolCalls = [];
      // turnToolUseIndices = [];
      pendingToolArgs.clear();
    };

    for await (const event of agent.run()) {
      switch (event.type) {
        case "stream_text": {
          fullText += event.text;
          streamingTextRef.current = fullText;
          // Throttled streaming: flush within 50ms to reduce React re-render churn
          streamThrottleRef.current ??= setTimeout(() => {
            setStreamingText(streamingTextRef.current);
            streamThrottleRef.current = null;
          }, 50);
          break;
        }

        case "thinking_text": {
          if (!turnThinkingStart) {
            turnThinkingStart = Date.now();
          }
          turnThinkingText += event.text;
          break;
        }

        case "thinking_complete": {
          if (turnThinkingStart) {
            turnThinkingDuration = (Date.now() - turnThinkingStart) / 1000;
          }
          // Don't add a separate "thinking" message -- it'll be folded into the turn summary.
          break;
        }

        case "tool_use": {
          const argsSummary = formatToolArgs(event.args);
          // Store for lookup when tool_result arrives (it lacks args).
          pendingToolArgs.set(`${event.toolName}:${event.toolId}`, argsSummary);
          // Show the active spinner while the tool runs.
          setActiveTools((prev) => [
            ...prev,
            { toolName: event.toolName, args: event.args, loading: true },
          ]);
          break;
        }

        case "tool_result": {
          // Look up the argsSummary we saved during tool_use.
          const argsSummary = pendingToolArgs.get(`${event.toolName}:${event.toolId}`) ?? "";
          const outputText = contentToText(event.output);
          // Update active tools spinner.
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolName === event.toolName && t.loading
                ? {
                    ...t,
                    output: outputText,
                    isError: event.isError,
                    elapsed: event.elapsed,
                    loading: false,
                  }
                : t,
            ),
          );
          // Accumulate into the turn summary.
          turnToolCalls.push({
            toolName: event.toolName,
            argsSummary,
            output: outputText,
            isError: event.isError,
            elapsed: event.elapsed,
          });
          break;
        }

        case "usage": {
          setInputTokens((prev) => prev + event.usage.inputTokens);
          setOutputTokens((prev) => prev + event.usage.outputTokens);
          break;
        }

        case "compact": {
          setMessages((prev) => [...prev, { role: "system", content: `⊙ ${event.message}` }]);
          if (event.boundary) {
            sessionMod.saveCompactBoundary(workDir, sessionIdRef.current, event.boundary);
          }
          break;
        }
        case "retry": {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `↻ ${event.reason}${event.delay ? ` (waiting ${String(Math.round(event.delay / 1000))}s)` : ""}`,
            },
          ]);
          break;
        }

        case "turn_complete": {
          if (streamThrottleRef.current) {
            clearTimeout(streamThrottleRef.current);
            streamThrottleRef.current = null;
          }
          setStreamingText("");
          fullText = "";
          setActiveTools([]);
          // Replace individual thinking + tool_use/tool_result messages from
          // this turn with a single collapsed turn_summary message.
          const hasTurnContent = turnThinkingText || turnToolCalls.length > 0;
          if (hasTurnContent) {
            const summary: ChatMessage = {
              role: "turn_summary",
              content: turnThinkingText,
              thinkingDuration: turnThinkingDuration > 0 ? turnThinkingDuration : undefined,
              toolSummary: turnToolCalls.length > 0 ? turnToolCalls : undefined,
            };
            setMessages((prev) => [...prev, summary]);
          }
          resetTurnAccumulators();
          break;
        }

        case "loop_complete": {
          if (streamThrottleRef.current) {
            clearTimeout(streamThrottleRef.current);
            streamThrottleRef.current = null;
          }
          setStreamingText("");
          if (fullText) {
            setMessages((prev) => [...prev, { role: "assistant" as const, content: fullText }]);
            // Assistant messages are persisted by the agent main loop as they
            // enter the conversation history (tool blocks included), so we don't duplicate that here
          }
          setActiveTools([]);
          resetTurnAccumulators();
          if (permModeRef.current === "plan") {
            setPlanApprovalActive(true);
          }
          break;
        }

        case "error": {
          throw event.error;
        }
      }
    }
  };

  const handlePlanApproval = useCallback(
    (choice: PlanChoice, feedback?: string) => {
      setPlanApprovalActive(false);
      const planPath = getOrCreatePlanPath(workDir);
      let planContent = "";
      try {
        if (existsSync(planPath)) {
          planContent = readFileSync(planPath, "utf-8");
        }
      } catch {
        /** noop */
      }

      if (choice === "yolo") {
        // Exit plan mode for YOLO approval
        hasExitedPlanModeRef.current = true;
        setPermMode("bypassPermissions");

        convRef.current.addSystemReminder(buildPlanModeExitReminder(planPath, !!planContent));
        setMessages((prev) => [
          ...prev,
          { role: "system", content: "Plan approved. Entered YOLO mode." },
        ]);
        if (planContent) {
          void handleSubmit(`Execute this plan:\n\n${planContent}`);
        }
      } else if (choice === "manual") {
        // Exit plan mode and restore the pre-plan permission mode
        hasExitedPlanModeRef.current = true;
        setPermMode(prePlanMode);
        convRef.current.addSystemReminder(buildPlanModeExitReminder(planPath, !!planContent));
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: "Plan approved. Each edit requires confirmation.",
          },
        ]);
        if (planContent) {
          void handleSubmit(`Execute this plan:\n\n${planContent}`);
        }
      } else if (choice === "feedback" && feedback) {
        void handleSubmit(feedback);
      }
    },
    [workDir, prePlanMode],
  );

  const handleRewindAction = useCallback(
    (action: RewindAction) => {
      setRewindDialogActive(false);
      const fh = fileHistoryRef.current;
      if (!fh) {
        return;
      }

      switch (action.type) {
        case "code_and_conversation": {
          const changed = fh.rewind(action.snapshotIndex);
          const snap = rewindSnapshots[action.snapshotIndex];
          convRef.current.truncateTo(snap.messageIndex);
          const fileList = changed.length > 0 ? "\n" + changed.map((f) => "  " + f).join("\n") : "";
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⟲ Rewound to checkpoint. Restored ${String(changed.length)} file(s) and conversation.${fileList}`,
            },
          ]);
          break;
        }
        case "conversation_only": {
          const snap = rewindSnapshots[action.snapshotIndex];
          convRef.current.truncateTo(snap.messageIndex);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⟲ Rewound conversation. Files unchanged.`,
            },
          ]);
          break;
        }
        case "code_only": {
          const changed = fh.rewind(action.snapshotIndex);
          const fileList = changed.length > 0 ? "\n" + changed.map((f) => "  " + f).join("\n") : "";
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⟲ Restored ${String(changed.length)} file(s). Conversation unchanged.${fileList}`,
            },
          ]);
          break;
        }
        case "cancel":
          break;
      }
    },
    [rewindSnapshots],
  );

  /**
   * 每轮对话前检查 skill 目录变化，变了就 reload catalog 并重连斜杠命令。
   * 系统提示词不动：新增的 Skill 由 skillDelta 在下一轮以 system-reminder
   * 补进对话，改系统提示词会让整段缓存前缀失效。
   */
  const refreshSkillsIfNeeded = () => {
    const catalog = skillCatalogRef.current;
    if (!catalog) {
      return;
    }
    if (!catalog.needsReload()) {
      return;
    }
    catalog.reload();
    wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);
  };

  const submittingRef = useRef(false);

  const handleSubmit = async (text: string) => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;

    refreshSkillsIfNeeded();

    // Save to prompt history
    historyMod.append(historyDir, text);
    setPromptHistory((prev) => [...prev, text]);

    // Handle slash commands
    if (text.startsWith("/")) {
      const handled = await handleSlashCommand(text);
      if (handled) {
        submittingRef.current = false;
        return;
      }
    }

    if (!clientRef.current) {
      setError("LLM client not ready yet");
      submittingRef.current = false;
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    // Inline any @file references for the model; @image references become
    // inline image content blocks. The UI keeps the original text the user typed.
    const expanded = await expandAtRefsWithImages(text, workDir);
    convRef.current.addUserMessage(expanded);

    // Save to session: the original typed text, plus any attached image
    // blocks (saveMessage swaps them for image_ref records on disk).
    sessionMod.saveMessage(workDir, sessionIdRef.current, {
      role: "user",
      content:
        typeof expanded === "string"
          ? text
          : [{ type: "text", text }, ...expanded.filter((b) => b.type === "image")],
      timestamp: Math.floor(Date.now() / 1000),
    });

    // If currently streaming, interrupt first
    if (isStreaming && abortControllerRef.current) {
      const partialText = streamingTextRef.current ?? "";
      abortControllerRef.current.abort();
      if (partialText) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: partialText + "\n\n*[cancelled]*" },
        ]);
      }
      setMessages((prev) => [...prev, { role: "system", content: "(response interrupted)" }]);
    }

    streamStartRef.current = Date.now();
    setCompletionMark(null);
    setIsStreaming(true);
    setStreamingText("");
    setError(null);
    setActiveTools([]);

    try {
      await runAgentLoop();
    } catch (err) {
      const msg = asErrorString(err);
      const isAbort = strArg(asRecord(err), "name") === "AbortError" || msg.includes("abort");
      if (isAbort) {
        const partialText = streamingTextRef.current;
        if (partialText) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: partialText + "\n\n*[cancelled]*" },
          ]);
        }
        setMessages((prev) => [...prev, { role: "system", content: "(response interrupted)" }]);
      } else {
        // API error (non-abort)
        const partialText = streamingTextRef.current;
        if (partialText) {
          setMessages((prev) => [...prev, { role: "assistant", content: partialText }]);
        }
        setError(msg);
        setMessages((prev) => [...prev, { role: "system", content: `Error: ${msg}` }]);
      }
    } finally {
      const elapsed = Math.floor((Date.now() - streamStartRef.current) / 1000);
      setCompletionMark(`✻ ${randomCompletionVerb()} for ${String(elapsed)}s`);
      setIsStreaming(false);
      setActiveTools([]);
      abortControllerRef.current = null;
      submittingRef.current = false;
    }
  };

  if (appState === "providerSelect") {
    return <ProviderSelect providers={providers} onSelect={handleProviderSelect} />;
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column" paddingTop={0} flexGrow={1}>
        {/* Finalized messages are written once into the terminal's native
            scrollback. This keeps the complete transcript selectable and
            copyable while only the active turn is re-rendered by Ink. */}
        <Static
          key={`transcript-${sessionIdRef.current}`}
          items={[
            {
              type: "brand" as const,
              _key: "brand",
              model: selectedProvider.model || selectedProvider.name,
              workDir,
            },
            ...messages.map((message, index) => ({
              type: "message" as const,
              _key: `message-${String(index)}`,
              message,
            })),
          ]}
        >
          {(item) =>
            item.type === "brand" ? (
              <Box key={item._key} flexDirection="column">
                <Text>
                  <Text color={BORDER_COLORS.focused}>{" /\\_/\\  "}</Text>
                  <Text dimColor>Swifty v{version}</Text>
                </Text>
                <Text>
                  <Text color={BORDER_COLORS.focused}>{"( o o ) "}</Text>
                  <Text dimColor>{item.model}</Text>
                </Text>
                <Text>
                  <Text color={BORDER_COLORS.focused}>{" >   <  "}</Text>
                  <Text dimColor>{item.workDir}</Text>
                </Text>
                <Text> </Text>
              </Box>
            ) : (
              <CommittedMessage key={item._key} message={item.message} expanded={toolsExpanded} />
            )
          }
        </Static>

        <ChatView
          messages={[]}
          streamingText={isStreaming ? streamingText : undefined}
          expanded={toolsExpanded}
        />

        {activeTools.length > 0 && !askRequest && <ToolDisplay tools={activeTools} />}

        {subagents.length > 0 && !askRequest && (
          <Box flexDirection="column" paddingLeft={1}>
            {subagents.map((s) => (
              <Text key={s.id} color="magenta">
                {ICONS.dot} {s.label} subagent · turn {s.turn}
                {s.lastTool ? ` · ${s.lastTool}` : ""}
              </Text>
            ))}
          </Box>
        )}

        {isStreaming && !askRequest && (
          <Box paddingLeft={1} flexDirection="column">
            <Spinner inputTokens={inputTokens} outputTokens={outputTokens} />
            {teammateStates.length > 0 && (
              <TeammateSpinnerTree
                teammates={teammateStates}
                leaderTokens={inputTokens + outputTokens}
              />
            )}
          </Box>
        )}
        {!isStreaming && teammateStates.some((t) => t.status === "running") && (
          <Box paddingLeft={1}>
            <TeammateSpinnerTree teammates={teammateStates} />
          </Box>
        )}

        {error && (
          <Box paddingLeft={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        {!isStreaming && completionMark && !askRequest && !permissionRequest && (
          <Box paddingLeft={1}>
            <Text dimColor>{completionMark}</Text>
          </Box>
        )}

        <Text> </Text>
      </Box>

      {planApprovalActive && <PlanApprovalDialog onSelect={handlePlanApproval} />}

      {rewindDialogActive && (
        <RewindDialog
          snapshots={rewindSnapshots}
          onComplete={handleRewindAction}
          onCancel={() => {
            setRewindDialogActive(false);
          }}
        />
      )}

      {permissionRequest && (
        <PermissionDialog
          toolName={permissionRequest.toolName}
          argsSummary={permissionRequest.argsSummary}
          reason={permissionRequest.reason}
          onComplete={(action: PermissionAction) => {
            permissionResolveRef.current?.(action);
            permissionResolveRef.current = null;
            setPermissionRequest(null);
          }}
        />
      )}

      {askRequest && (
        <AskUserDialog
          questions={askRequest}
          onComplete={(answers) => {
            askResolveRef.current?.(answers);
            askResolveRef.current = null;
            setAskRequest(null);
          }}
        />
      )}

      {teamsDialogOpen && (
        <TeamsDialog
          teammates={teammateStates}
          onClose={() => {
            setTeamsDialogOpen(false);
          }}
          onKill={(name, teamName) => {
            const team = teamManagerRef.current.get(teamName);
            if (team) {
              void team.stopMember(name);
            }
          }}
          onShutdown={(name, teamName) => {
            const team = teamManagerRef.current.get(teamName);
            if (team) {
              void team.sendMessage("lead", name, "[shutdown] Please finish and exit");
            }
          }}
        />
      )}

      {ctrlCHint && (
        <Box paddingLeft={1}>
          <Text dimColor>Press Ctrl+C again to exit.</Text>
        </Box>
      )}
      <TeamStatus
        count={teammateStates.filter((t) => t.status === "running" || t.status === "idle").length}
      />
      <InputBox
        onSubmit={(text: string) => {
          void handleSubmit(text);
        }}
        disabled={rewindDialogActive || permissionRequest !== null || askRequest !== null}
        history={promptHistory}
        commands={cmdRegistryRef.current.listCommands()}
        usageTracker={usageTrackerRef.current}
        inputState={
          error
            ? "error"
            : isStreaming || rewindDialogActive || permissionRequest
              ? "idle"
              : "focused"
        }
        permMode={permMode}
        onModeChange={(mode) => {
          setPermMode(mode);
        }}
        workDir={workDir}
        insertTextRef={insertInputTextRef}
        onEscape={() => {
          if (isStreaming) {
            abortControllerRef.current?.abort();
          }
        }}
      />
    </Box>
  );
}

// Compose the coordinator filter (active when teams exist) with an optional
// skill-based filter. Both must agree for a tool to be included. When no
// skill filter is set, only the coordinator filter is consulted.
function buildComposedToolFilter(
  coordinator: (name: string) => boolean,
  skillFilter: ((name: string) => boolean) | null,
): (name: string) => boolean {
  if (!skillFilter) {
    return coordinator;
  }
  return (name: string) => coordinator(name) && skillFilter(name);
}
