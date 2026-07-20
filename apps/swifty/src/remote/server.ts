// Remote server: Koa.js HTTP + WebSocket bridge for browser-based access.
// Serves the React frontend (fe/dist/) and bridges Agent events to WS.
// Equivalent migration from server-old.ts with static-file Koa serving.

import Koa from "koa";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { cwd } from "node:process";
import z from "zod";

import type { HookConfig, MCPServerConfig, ProviderConfig } from "../config/config.js";
import { getContextWindow, getContextWindowAsync, getMaxOutputTokens } from "../config/config.js";
import { createClient, type LLMClient } from "../llm/client.js";
import { resolveModelId } from "../llm/model-resolver.js";
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
import { AskUserQuestionTool, type Question, type Asker } from "../tools/ask-user.js";
import { FileStateCache } from "../tools/file-state-cache.js";
import type { ToolSchema } from "../tools/types.js";
import { Agent } from "../agent/agent.js";
import type { AgentEvent } from "../agent/events.js";
import { PermissionChecker, type Decision } from "../permissions/checker.js";
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
import type { SkillHost } from "../skills/skill.js";
import { LoadSkillTool } from "../skills/load-skill-tool.js";
import { runInline as runSkillInline } from "../skills/executor.js";
import { TaskList } from "../todo/todo.js";
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from "../todo/tools.js";
import { TaskStore } from "../todo/store.js";
import { AgentTool } from "../subagent/agent-tool.js";
import { spawnSubagent } from "../subagent/spawn.js";
import { TeamCreateTool, SendMessageTool, TeamDeleteTool } from "../teams/tools.js";
import { TeamManager, type RunAgent } from "../teams/team.js";
import { HookEngine, validate as validateHooks } from "../hooks/hooks.js";
import { forceCompact } from "../compact/compact.js";
import { RecoveryState } from "../compact/recovery.js";
import { getOrCreatePlanPath } from "../plan-file/plan-file.js";
import { FileHistory } from "../file-history/file-history.js";
import {
  newSessionId,
  saveMessage,
  saveCompactBoundary,
  listSessions,
  loadSession,
  rebuildFromSession,
  getSessionFilePath,
} from "../session/session.js";
import { createChildLogger } from "../logger/index.js";
import { strArg } from "@/utils/index.js";
import { BUILTIN_AGENTS } from "@/subagent/definition.js";

const log = createChildLogger({ module: "remote" });

// -- WS inbound/outbound types and Zod schemas --------------------------------

interface WsOutbound {
  type: string;
  data: unknown;
}

const WsInboundSchema = z.object({
  type: z.string(),
  data: z.unknown(),
});

const UserMessageSchema = z.object({
  content: z.string(),
});

const PermissionResponseSchema = z.object({
  id: z.string(),
  response: z.enum(["allow", "deny", "allowAlways"]),
});

const AskUserResponseSchema = z.object({
  id: z.string(),
  answers: z.record(z.string(), z.string()),
});

// -- Static file serving -------------------------------------------------------

const FE_DIST = join(import.meta.dirname, "fe", "dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Serves a static file from fe/dist/. Returns null if not found. */
function serveStatic(path: string): { body: Buffer; mime: string } | null {
  // Normalize and prevent path traversal
  const cleanPath = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const fullPath = join(FE_DIST, cleanPath);

  // Ensure the resolved path is still under FE_DIST
  if (!fullPath.startsWith(FE_DIST)) {
    return null;
  }

  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    return null;
  }

  const body = readFileSync(fullPath);
  const mime = MIME_TYPES[extname(fullPath)] ?? "application/octet-stream";
  return { body, mime };
}

// -- RemoteAgentHandle interface -----------------------------------------------

/** Callbacks injected into each agent run for permission and user-interaction flows. */
export interface RunCallbacks {
  onPermissionRequest: (
    toolName: string,
    args: Record<string, unknown>,
    decision: Decision,
  ) => Promise<"allow" | "deny" | "allowAlways">;
}

/** Encapsulates ALL agent state needed by the remote server. */
export interface RemoteAgentHandle {
  client: LLMClient;
  conv: ConversationManager;
  registry: ToolRegistry;
  sessionId: string;
  fileHistory: FileHistory;
  fileStateCache: FileStateCache;
  cmdRegistry: CommandRegistry;
  skillCatalog: SkillCatalog | null;
  activeSkills: Map<string, string>;
  toolFilter: ((name: string) => boolean) | null;
  mcpManager: MCPManager | null;
  hookEngine: HookEngine | null;
  recoveryState: RecoveryState;
  teamManager: TeamManager;
  memoryManager: MemoryManager;
  contextWindow: number;
  ltmInstructions: string;
  ltmMemoryContent: string;
  mcpInstructions: string;
  provider: ProviderConfig;
  workDir: string;

  /** Runs the agent loop: adds the user message, creates Agent, and yields events. */
  run(text: string, callbacks: RunCallbacks): AsyncGenerator<AgentEvent>;

  /** Aborts the currently running agent loop (if any). */
  abort(): void;
}

// -- Agent handle implementation -----------------------------------------------

class AgentHandleImpl implements RemoteAgentHandle {
  client: LLMClient;
  conv: ConversationManager;
  registry: ToolRegistry;
  sessionId: string;
  fileHistory: FileHistory;
  fileStateCache: FileStateCache;
  cmdRegistry: CommandRegistry;
  skillCatalog: SkillCatalog | null;
  activeSkills: Map<string, string>;
  toolFilter: ((name: string) => boolean) | null;
  mcpManager: MCPManager | null;
  hookEngine: HookEngine | null;
  recoveryState: RecoveryState;
  teamManager: TeamManager;
  memoryManager: MemoryManager;
  contextWindow: number;
  ltmInstructions: string;
  ltmMemoryContent: string;
  mcpInstructions: string;
  provider: ProviderConfig;
  workDir: string;

  private abortController: AbortController | null = null;

  constructor(init: Omit<AgentHandleImpl, "abortController" | "run" | "abort">) {
    this.client = init.client;
    this.conv = init.conv;
    this.registry = init.registry;
    this.sessionId = init.sessionId;
    this.fileHistory = init.fileHistory;
    this.fileStateCache = init.fileStateCache;
    this.cmdRegistry = init.cmdRegistry;
    this.skillCatalog = init.skillCatalog;
    this.activeSkills = init.activeSkills;
    this.toolFilter = init.toolFilter;
    this.mcpManager = init.mcpManager;
    this.hookEngine = init.hookEngine;
    this.recoveryState = init.recoveryState;
    this.teamManager = init.teamManager;
    this.memoryManager = init.memoryManager;
    this.contextWindow = init.contextWindow;
    this.ltmInstructions = init.ltmInstructions;
    this.ltmMemoryContent = init.ltmMemoryContent;
    this.mcpInstructions = init.mcpInstructions;
    this.provider = init.provider;
    this.workDir = init.workDir;
    this.abortController = null;
  }

  async *run(text: string, callbacks: RunCallbacks): AsyncGenerator<AgentEvent> {
    // Add user message to conversation
    this.conv.addUserMessage(text);

    // One-time MCP instructions injection
    if (this.mcpInstructions) {
      this.conv.addSystemReminder(this.mcpInstructions);
      this.mcpInstructions = "";
    }

    // Create abort controller for this run
    this.abortController = new AbortController();

    try {
      const checker = new PermissionChecker(this.workDir, "default");
      const agent = new Agent({
        client: this.client,
        registry: this.registry,
        checker,
        conversation: this.conv,
        workDir: this.workDir,
        sessionId: this.sessionId,
        hookEngine: this.hookEngine ?? undefined,
        fileHistory: this.fileHistory ?? undefined,
        fileStateCache: this.fileStateCache,
        abortSignal: this.abortController.signal,
        contextWindow: this.contextWindow,
        maxOutput: getMaxOutputTokens(this.provider),
        recoveryState: this.recoveryState,
        activeSkills: this.activeSkills,
        toolFilter: this.toolFilter ?? undefined,
        instructions: this.ltmInstructions,
        memoryContent: this.ltmMemoryContent,
        notificationFn: () => this.teamManager.drainLeads(),
        onPermissionRequest: callbacks.onPermissionRequest,
        onLoopComplete: (conv) => {
          // Best-effort memory extraction (fire-and-forget)
          const summary = conv
            .getMessages()
            .slice(-40)
            .map((m) => `[${m.role}]: ${m.content}`)
            .filter((s) => s.length > 12)
            .join("\n");
          new MemoryExtractor(this.client, this.workDir).extract(summary).catch(() => {
            /* non-fatal */
          });

          // Background memory consolidation (fire-and-forget)
          new MemoryConsolidator(this.client, this.workDir, {
            appendSystem: (msg) => {
              conv.addSystemReminder(msg);
            },
          })
            .maybeRun()
            .catch(() => {
              /* non-fatal */
            });
        },
      });

      yield* agent.run();
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}

// -- createRemoteAgent factory -------------------------------------------------

interface CreateRemoteAgentOptions {
  provider: ProviderConfig;
  workDir: string;
  hooks?: HookConfig[];
  mcpServers?: MCPServerConfig[];
  askUser: Asker;
}

/**
 * Initializes the full agent stack: tools, LLM client, conversation, session,
 * skills, hooks, MCP servers, team management, and memory.
 * Replicates ALL logic from server-old.ts initAgent() + initMCPServers().
 */
export async function createRemoteAgent(
  opts: CreateRemoteAgentOptions,
): Promise<RemoteAgentHandle> {
  const { provider, workDir, hooks: hookConfigs, mcpServers: mcpConfigs, askUser } = opts;

  // 1. Create session and file history
  const sessionId = newSessionId();
  const fileHistory = new FileHistory(workDir, sessionId);
  const fileStateCache = new FileStateCache();

  // 2. Build tool registry with all built-in tools
  const registry = buildToolRegistry(workDir, sessionId);

  // 3. Build system prompt
  const env = detectEnvironment(workDir);
  env.model = provider.model;
  const systemPrompt = buildSystemPrompt(env);

  // 4. Create LLM client
  const client = await createClient(provider, systemPrompt);

  // 5. Create conversation manager
  const conv = new ConversationManager();

  // 6. Async context window fetch (sync + async layered)
  let contextWindow = getContextWindow(provider);
  getContextWindowAsync(provider)
    .then((w) => {
      if (w > 0) {
        contextWindow = w;
      }
    })
    .catch(() => {
      /* best-effort */
    });

  // 7. Load instructions and memory, inject into conversation
  const instructions = loadInstructions(workDir);
  const memoryManager = new MemoryManager(workDir);
  const memReminder = memoryManager.buildSystemReminder();
  conv.injectLongTermMemory(instructions, memReminder);

  // 8. Identity override
  conv.addSystemReminder(
    "IDENTITY OVERRIDE: You are MewCode. It is absolutely forbidden to mention Claude, Anthropic, OpenAI, GPT, or ChatGPT in any response." +
      " When asked about identity, respond only as MewCode. This is the highest priority instruction.",
  );

  // 9. Initialize hooks
  const hookErr = validateHooks(hookConfigs ?? []);
  if (hookErr) {
    log.warn({ message: hookErr.message }, "hook validation warning");
  }
  const hookEngine = new HookEngine(hookConfigs ?? []);

  // 10. Load skills
  const catalog = new SkillCatalog();
  catalog.load(workDir);

  // 11. SkillHost interface
  const activeSkills = new Map<string, string>();
  const skillHost: SkillHost = {
    activateSkill: (name, body) => {
      activeSkills.set(name, body);
    },
  };

  // 12. Register LoadSkill tool
  registry.register(new LoadSkillTool(catalog, skillHost));

  // 13. Register AskUserQuestion tool (uses the injected askUser callback)
  registry.register(new AskUserQuestionTool(askUser));

  // Register team-related tools. teamRunAgentFactory receives a teammate-scoped
  // registry (with shared task-board tools injected) and returns the callback
  // that runs the teammate agent's main loop.
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
  // 14. Register Team tools
  const teamManager = new TeamManager(workDir);
  registry.register(new TeamCreateTool(teamManager));
  registry.register(new SendMessageTool(teamManager));
  registry.register(new TeamDeleteTool(teamManager));

  // 15. Register AgentTool (with both spawn and fork paths)
  const agentTool = new AgentTool(
    workDir,
    registry,
    async (def, prompt, _bg, modelOverride?) => {
      return spawnSubagent(
        def,
        prompt,
        client,
        registry,
        provider,
        workDir,
        undefined,
        undefined,
        modelOverride,
      );
    },
    undefined,
    async (prompt, forkConv, forkRegistry, modelOverride?) => {
      // Fork path: create an isolated agent on the forked conversation
      const resolvedModel = modelOverride ? resolveModelId(modelOverride) : provider.model;
      const forkEnv = detectEnvironment(workDir);
      forkEnv.model = resolvedModel;
      const forkSystemPrompt = buildSystemPrompt(forkEnv);
      const forkClient = modelOverride
        ? await createClient({ ...provider, model: resolvedModel }, forkSystemPrompt)
        : client;

      const checker = new PermissionChecker(workDir, "acceptEdits");
      forkConv.addUserMessage(prompt);

      const agent = new Agent({
        client: forkClient,
        registry: forkRegistry,
        checker,
        conversation: forkConv,
        workDir,
        maxIterations: 200,
      });

      let output = "";
      for await (const event of agent.run()) {
        switch (event.type) {
          case "stream_text":
            output += event.text;
            break;
          case "loop_complete":
            return output || "[No output]";
          case "error":
            return output
              ? `${output}\n\n[Error: ${event.error.message}]`
              : `Error: ${event.error.message}`;
        }
      }
      return output || "[No output]";
    },
  );

  agentTool.setTeamManager(teamManager, teamRunAgentFactory);
  registry.register(agentTool);

  // 16. Load user-defined slash commands
  const cmdRegistry = createCommandRegistry();
  for (const cmd of loadUserCommands(workDir)) {
    try {
      cmdRegistry.register(cmd);
    } catch {
      // Name conflict: keep built-in command
    }
  }

  // 17. Wire skills to slash commands
  wireSkillsToCommands(catalog, skillHost, cmdRegistry);

  // 18. Initialize MCP servers
  let mcpManager: MCPManager | null = null;
  let mcpInstructions = "";

  if (mcpConfigs && mcpConfigs.length > 0) {
    const mgr = new MCPManager();
    mcpManager = mgr;

    const result = await mgr.connectAll(mcpConfigs);

    // Register all MCP tools
    for (const { serverName, tool } of result.tools) {
      const mcpClient = mgr.getClient(serverName);
      if (mcpClient) {
        registry.register(new MCPToolWrapper(mcpClient, serverName, tool));
      }
    }

    // Log errors
    for (const { serverName, error } of result.errors) {
      log.error({ serverName, error }, "MCP server connection error");
    }

    // Collect MCP instructions
    if (result.instructions.length > 0) {
      const parts = result.instructions.map(({ serverName, text }) => `## ${serverName}\n${text}`);
      mcpInstructions =
        "# MCP Server Instructions\n\nThe following MCP servers are connected. Use their tools when the user asks.\n\n" +
        parts.join("\n\n");
    }
  }

  // 19. Construct the handle
  return new AgentHandleImpl({
    client,
    conv,
    registry,
    sessionId,
    fileHistory,
    fileStateCache,
    cmdRegistry,
    skillCatalog: catalog,
    activeSkills,
    toolFilter: null,
    mcpManager,
    hookEngine,
    recoveryState: new RecoveryState(),
    teamManager,
    memoryManager,
    contextWindow,
    ltmInstructions: instructions,
    ltmMemoryContent: memReminder,
    mcpInstructions,
    provider,
    workDir,
  });
}

// -- Helper functions for agent initialization ---------------------------------

/** Creates the tool registry and registers all 14 built-in tools. */
function buildToolRegistry(workDir: string, sessionId: string): ToolRegistry {
  const store = new TaskStore(workDir, sessionId);
  const taskList = new TaskList(store);

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

/** Registers loaded skills as slash commands (inline mode -> prompt type, fork mode -> skill_fork). */
function wireSkillsToCommands(
  catalog: SkillCatalog,
  skillHost: SkillHost,
  cmdRegistry: CommandRegistry,
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
      // Name conflict: skip
    }
  }
}

// -- Permission description formatter ------------------------------------------

/** Formats a permission request description for the WS client popup. */
function formatPermissionDesc(
  toolName: string,
  args: Record<string, unknown>,
  decision: Decision,
): string {
  const parts: string[] = [];
  if (decision.reason) {
    parts.push(decision.reason);
  }
  if (args.command) {
    parts.push(`Command: ${strArg(args, "command")}`);
  } else if (args.file_path) {
    parts.push(`File: ${strArg(args, "file_path")}`);
  }
  return parts.join("\n");
}

// -- RemoteServer --------------------------------------------------------------

interface RemoteServerOptions {
  providers: ProviderConfig[];
  mcpServers?: MCPServerConfig[];
  hookConfigs?: HookConfig[];
  addr: string;
}

export class RemoteServer {
  private app: Koa;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private opts: RemoteServerOptions;

  // Agent handle
  private agentHandle: RemoteAgentHandle | null = null;
  private streaming = false;
  private turnCount = 0;

  // Pending permission/ask-user requests waiting for WS client responses
  private pendingPermissions = new Map<
    string,
    (response: "allow" | "deny" | "allowAlways") => void
  >();
  private pendingAsks = new Map<string, (answers: Record<string, string>) => void>();

  constructor(opts: RemoteServerOptions) {
    this.opts = opts;
    this.app = new Koa();
    this.server = createServer((req, res) => {
      void this.app.callback()(req, res);
    });
    this.wss = new WebSocketServer({ server: this.server });
    this.setupRoutes();
    this.setupWebSocket();
  }

  /** Configures Koa middleware: static file serving + health check. */
  private setupRoutes(): void {
    // Health check
    this.app.use(async (ctx, next) => {
      if (ctx.path === "/health") {
        ctx.body = { status: "ok", remote: true, clients: this.clients.size };
        return;
      }
      await next();
    });

    // Static file serving for fe/dist/
    this.app.use((ctx) => {
      // Root path -> index.html
      const filePath = ctx.path === "/" ? "/index.html" : ctx.path;
      const result = serveStatic(filePath);
      if (result) {
        ctx.type = result.mime;
        ctx.body = result.body;
        return;
      }

      // Fallback: serve index.html for client-side routing (SPA)
      const indexResult = serveStatic("/index.html");
      if (indexResult) {
        ctx.type = indexResult.mime;
        ctx.body = indexResult.body;
        return;
      }

      ctx.status = 404;
      ctx.body = "Not found";
    });
  }

  /** Configures WebSocket connection handling. */
  private setupWebSocket(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);
      log.info({ clients: this.clients.size }, "WebSocket client connected");

      // Send initial connected message to the newly connected client only
      this.send(ws, {
        type: "connected",
        data: { session: this.agentHandle?.sessionId ?? "", cwd: cwd() },
      });

      // Send available slash commands
      this.send(ws, { type: "commands", data: this.buildCommandList() });

      ws.on("message", (data: Buffer) => {
        const parsed = WsInboundSchema.safeParse(JSON.parse(data.toString("utf-8")));
        if (!parsed.success) {
          log.error("failed to parse WS message");
          return;
        }
        void this.handleWsMessage(parsed.data);
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        log.info({ clients: this.clients.size }, "WebSocket client disconnected");
      });

      ws.on("error", () => {
        this.clients.delete(ws);
      });
    });
  }

  /** Handles incoming WebSocket messages from the Web UI. */
  private async handleWsMessage(msg: z.infer<typeof WsInboundSchema>): Promise<void> {
    switch (msg.type) {
      case "user_message": {
        const parsed = UserMessageSchema.safeParse(msg.data);
        if (parsed.success) {
          await this.handleUserMessage(parsed.data.content);
        }
        break;
      }
      case "permission_response": {
        const parsed = PermissionResponseSchema.safeParse(msg.data);
        if (parsed.success) {
          const resolver = this.pendingPermissions.get(parsed.data.id);
          if (resolver) {
            resolver(parsed.data.response);
            this.pendingPermissions.delete(parsed.data.id);
          }
        }
        break;
      }
      case "ask_user_response": {
        const parsed = AskUserResponseSchema.safeParse(msg.data);
        if (parsed.success) {
          const resolver = this.pendingAsks.get(parsed.data.id);
          if (resolver) {
            resolver(parsed.data.answers);
            this.pendingAsks.delete(parsed.data.id);
          }
        }
        break;
      }
      case "cancel": {
        this.agentHandle?.abort();
        break;
      }
      case "ping": {
        this.broadcast({ type: "pong", data: null });
        break;
      }
      default:
        log.warn({ type: msg.type }, "unknown WS message type");
    }
  }

  /** Handles a user message: creates agent (if needed) and streams events. */
  private async handleUserMessage(content: string): Promise<void> {
    const text = content.trim();
    if (!text || this.streaming) {
      return;
    }

    // Create agent eagerly on first message (if not yet initialized)
    if (!this.agentHandle) {
      try {
        this.agentHandle = await createRemoteAgent({
          provider: this.opts.providers[0],
          workDir: cwd(),
          hooks: this.opts.hookConfigs,
          mcpServers: this.opts.mcpServers,
          askUser: this.createAskUserCallback(),
        });
        // Broadcast connected with the real session ID
        this.broadcast({
          type: "connected",
          data: { session: this.agentHandle.sessionId, cwd: cwd() },
        });
      } catch (err) {
        log.error({ err }, "failed to initialize agent");
        this.broadcast({
          type: "error",
          data: {
            message: `Failed to initialize agent: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
        return;
      }
    }

    // Slash command handling
    if (text.startsWith("/")) {
      await this.handleSlashCommand(text);
      return;
    }

    this.streaming = true;
    const startTime = Date.now();
    const workDir = this.agentHandle.workDir;
    const sessionId = this.agentHandle.sessionId;

    // Persist user message to session
    saveMessage(workDir, sessionId, {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    });

    try {
      const callbacks: RunCallbacks = {
        onPermissionRequest: async (
          toolName: string,
          args: Record<string, unknown>,
          decision: Decision,
        ): Promise<"allow" | "deny" | "allowAlways"> => {
          const id = `perm_${Date.now().toString(36)}`;
          const desc = formatPermissionDesc(toolName, args, decision);
          this.broadcast({
            type: "permission_request",
            data: { id, toolName, description: desc },
          });
          return new Promise((resolve) => {
            this.pendingPermissions.set(id, resolve);
          });
        },
      };

      let streamBuf = "";
      for await (const ev of this.agentHandle.run(text, callbacks)) {
        // Flush accumulated stream text BEFORE tool_result/turn_complete/loop_complete
        if (
          ev.type === "tool_result" ||
          ev.type === "turn_complete" ||
          ev.type === "loop_complete"
        ) {
          if (streamBuf) {
            this.broadcast({ type: "stream_end", data: { text: streamBuf } });
            streamBuf = "";
          }
        }
        this.bridgeEvent(ev, startTime, workDir, sessionId, (t) => {
          streamBuf += t;
        });
      }
    } catch (err) {
      log.error({ err }, "agent stream error");
      this.broadcast({
        type: "error",
        data: { message: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      this.streaming = false;
    }
  }

  /** Bridges an AgentEvent to the corresponding WS message and session persistence. */
  private bridgeEvent(
    ev: AgentEvent,
    startTime: number,
    workDir: string,
    sessionId: string,
    appendStream: (text: string) => void,
  ): void {
    switch (ev.type) {
      case "stream_text":
        appendStream(ev.text);
        this.broadcast({ type: "stream_text", data: { text: ev.text } });
        break;

      case "thinking_text":
        this.broadcast({ type: "thinking_text", data: { text: ev.text } });
        break;

      case "thinking_complete":
        // No WS message needed; handled internally by Agent
        break;

      case "tool_use":
        this.broadcast({
          type: "tool_use",
          data: { toolId: ev.toolId, toolName: ev.toolName, args: ev.args },
        });
        break;

      case "tool_result":
        this.broadcast({
          type: "tool_result",
          data: {
            toolId: ev.toolId,
            toolName: ev.toolName,
            output: ev.output,
            isError: ev.isError,
            elapsed: ev.elapsed,
          },
        });
        break;

      case "turn_complete":
        this.turnCount++;
        this.broadcast({
          type: "turn_complete",
          data: { turn: this.turnCount },
        });
        break;

      case "loop_complete": {
        const elapsed = (Date.now() - startTime) / 1000;
        this.broadcast({
          type: "loop_complete",
          data: {
            stopReason: ev.stopReason,
            totalTurns: this.turnCount,
            elapsed,
          },
        });
        break;
      }

      case "usage":
        this.broadcast({
          type: "usage",
          data: {
            inputTokens: ev.usage.inputTokens,
            outputTokens: ev.usage.outputTokens,
          },
        });
        break;

      case "error":
        this.broadcast({
          type: "error",
          data: { message: ev.error.message },
        });
        break;

      case "compact":
        this.broadcast({ type: "compact", data: { message: ev.message } });
        // Persist compact boundary
        if (ev.boundary) {
          saveCompactBoundary(workDir, sessionId, ev.boundary);
        }
        break;

      case "retry":
        this.broadcast({
          type: "retry",
          data: { reason: ev.reason, waitMs: ev.delay },
        });
        break;

      case "permission_request":
        // Handled by onPermissionRequest callback; no-op here
        break;
    }
  }

  // -- Slash command handling ---------------------------------------------------

  /** Handles slash command input: parse, dispatch to handler by type. */
  private async handleSlashCommand(input: string): Promise<void> {
    if (!this.agentHandle) {
      return;
    }

    const parsed = parseCommand(input);
    if (!parsed) {
      return;
    }

    const { name, args } = parsed;
    const cmd = this.agentHandle.cmdRegistry.find(name);

    if (!cmd) {
      this.broadcast({
        type: "error",
        data: {
          message: `Unknown command: /${name} -- type /help to see available commands`,
        },
      });
      this.broadcast({ type: "command_done", data: null });
      return;
    }

    const ctx = this.buildCommandContext(args);

    switch (cmd.type) {
      case "local": {
        const result = cmd.handler(ctx);
        this.broadcast({ type: "system", data: { message: result } });
        this.broadcast({ type: "command_done", data: null });
        break;
      }

      case "local_ui":
        await this.handleLocalUICommand(name, args);
        break;

      case "prompt": {
        const prompt = cmd.handler(ctx);
        const displayText = args ? `/${name} ${args}` : `/${name}`;

        this.streaming = true;
        const workDir = this.agentHandle.workDir;
        const sessionId = this.agentHandle.sessionId;

        // Persist the display text (not the handler output)
        saveMessage(workDir, sessionId, {
          role: "user",
          content: displayText,
          timestamp: new Date().toISOString(),
        });

        const startTime = Date.now();
        try {
          const callbacks: RunCallbacks = {
            onPermissionRequest: this.createPermissionCallback(),
          };

          let streamBuf = "";
          // handle.run() adds the prompt to conv and injects MCP instructions
          for await (const ev of this.agentHandle.run(prompt, callbacks)) {
            if (
              ev.type === "tool_result" ||
              ev.type === "turn_complete" ||
              ev.type === "loop_complete"
            ) {
              if (streamBuf) {
                this.broadcast({
                  type: "stream_end",
                  data: { text: streamBuf },
                });
                streamBuf = "";
              }
            }
            this.bridgeEvent(ev, startTime, workDir, sessionId, (t) => {
              streamBuf += t;
            });
          }
        } catch (err) {
          log.error({ err }, "agent stream error in prompt command");
          this.broadcast({
            type: "error",
            data: { message: err instanceof Error ? err.message : String(err) },
          });
        } finally {
          this.streaming = false;
        }
        break;
      }

      case "skill_fork":
        this.broadcast({
          type: "system",
          data: {
            message: "Fork-mode skills are not yet supported in remote mode.",
          },
        });
        this.broadcast({ type: "command_done", data: null });
        break;
    }
  }

  /** Handles local_ui commands (clear, compact, plan, resume, rewind, quit, etc.). */
  private async handleLocalUICommand(name: string, args: string): Promise<void> {
    if (!this.agentHandle) {
      return;
    }

    switch (name) {
      case "clear":
        this.agentHandle.conv = new ConversationManager();
        this.agentHandle.activeSkills.clear();
        this.agentHandle.toolFilter = null;
        this.broadcast({ type: "clear", data: null });
        this.broadcast({ type: "command_done", data: null });
        break;

      case "compact":
        await this.handleCompact();
        break;

      case "plan":
        await this.handlePlan(args);
        break;

      case "resume":
        this.handleResume(args);
        break;

      case "rewind":
        this.broadcast({
          type: "system",
          data: { message: "Rewind is not yet supported in remote mode." },
        });
        this.broadcast({ type: "command_done", data: null });
        break;

      case "quit":
        this.broadcast({
          type: "system",
          data: {
            message: "Quit is not supported in remote mode. Close the browser tab.",
          },
        });
        this.broadcast({ type: "command_done", data: null });
        break;

      case "skills": {
        const catalog = this.agentHandle.skillCatalog;
        if (!catalog) {
          this.broadcast({
            type: "system",
            data: { message: "No skills loaded." },
          });
        } else {
          const skills = catalog.list();
          if (skills.length === 0) {
            this.broadcast({
              type: "system",
              data: { message: "No skills found." },
            });
          } else {
            const lines = skills.map((s) => `  ${s.name}: ${s.description}`);
            this.broadcast({
              type: "system",
              data: {
                message: `Available skills (${String(skills.length)}):\n\n${lines.join("\n")}`,
              },
            });
          }
        }
        this.broadcast({ type: "command_done", data: null });
        break;
      }

      case "sandbox":
        this.broadcast({
          type: "system",
          data: {
            message: "Sandbox toggle is not yet supported in remote mode.",
          },
        });
        this.broadcast({ type: "command_done", data: null });
        break;

      case "worktree":
        this.broadcast({
          type: "system",
          data: {
            message: "Worktree management is not yet supported in remote mode.",
          },
        });
        this.broadcast({ type: "command_done", data: null });
        break;

      default:
        this.broadcast({ type: "command_done", data: null });
        break;
    }
  }

  /** Builds a CommandContext for slash command execution. */
  private buildCommandContext(args: string): CommandContext {
    const handle = this.agentHandle;
    if (!handle) {
      return { workDir: cwd(), args, model: "" };
    }
    return {
      workDir: handle.workDir,
      args,
      permissionMode: () => "default",
      tokenCount: () => [0, 0] as const,
      toolCount: () => handle.registry.listTools().length,
      memoryList: () => handle.memoryManager.getMemories().map((m) => m.name),
      model: handle.provider.model,
    };
  }

  /** Handles /compact command: force context compaction. */
  private async handleCompact(): Promise<void> {
    if (!this.agentHandle) {
      return;
    }
    const handle = this.agentHandle;

    this.broadcast({
      type: "system",
      data: { message: "Compacting conversation..." },
    });

    try {
      const toolNames = handle.registry.listTools().map((t) => t.name);
      const toolSchemas = handle.registry.getAllSchemas();
      const result = await forceCompact(
        handle.conv,
        handle.client,
        handle.recoveryState,
        toolNames,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        toolSchemas as ToolSchema[],
        getSessionFilePath(handle.workDir, handle.sessionId),
      );
      this.broadcast({
        type: "system",
        data: { message: `Compacted: ${result.message}` },
      });
      if (result.boundary) {
        saveCompactBoundary(handle.workDir, handle.sessionId, result.boundary);
      }
    } catch (err) {
      this.broadcast({
        type: "error",
        data: { message: err instanceof Error ? err.message : String(err) },
      });
    }

    this.broadcast({ type: "command_done", data: null });
  }

  /** Handles /plan command: enter plan mode, optionally with args. */
  private async handlePlan(args: string): Promise<void> {
    if (!this.agentHandle) {
      return;
    }
    const handle = this.agentHandle;
    const workDir = handle.workDir;
    const planPath = getOrCreatePlanPath(workDir);

    this.broadcast({
      type: "system",
      data: {
        message: `Entered Plan mode. Plan file: ${planPath}\nExplore the codebase and design your approach.`,
      },
    });

    if (args) {
      // With arguments: send to agent loop
      this.streaming = true;
      saveMessage(workDir, handle.sessionId, {
        role: "user",
        content: `/plan ${args}`,
        timestamp: new Date().toISOString(),
      });

      const startTime = Date.now();
      try {
        const callbacks: RunCallbacks = {
          onPermissionRequest: this.createPermissionCallback(),
        };

        let streamBuf = "";
        for await (const ev of handle.run(args, callbacks)) {
          if (
            ev.type === "tool_result" ||
            ev.type === "turn_complete" ||
            ev.type === "loop_complete"
          ) {
            if (streamBuf) {
              this.broadcast({ type: "stream_end", data: { text: streamBuf } });
              streamBuf = "";
            }
          }
          this.bridgeEvent(ev, startTime, workDir, handle.sessionId, (t) => {
            streamBuf += t;
          });
        }
      } catch (err) {
        log.error({ err }, "agent stream error in plan command");
        this.broadcast({
          type: "error",
          data: { message: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        this.streaming = false;
      }
    } else {
      this.broadcast({ type: "command_done", data: null });
    }
  }

  /** Handles /resume command: resume a previous session. */
  private handleResume(args: string): void {
    if (!this.agentHandle) {
      return;
    }
    const handle = this.agentHandle;
    const workDir = handle.workDir;
    const sessions = listSessions(workDir);

    if (!args) {
      // No arguments: list available sessions
      if (sessions.length === 0) {
        this.broadcast({
          type: "system",
          data: { message: "No previous sessions found." },
        });
        this.broadcast({ type: "command_done", data: null });
        return;
      }

      const lines: string[] = [`Available sessions (${String(sessions.length)}):\n`];
      for (let i = 0; i < Math.min(sessions.length, 20); i++) {
        const sess = sessions[i];
        let first = sess.firstMessage;
        if (first.length > 60) {
          first = first.slice(0, 60) + "...";
        }
        lines.push(`  ${String(i + 1)}. [${sess.id}] ${first} (${String(sess.messageCount)} msgs)`);
      }
      if (sessions.length > 20) {
        lines.push(`  ... and ${String(sessions.length - 20)} more`);
      }
      lines.push("\nUsage: /resume <number> or /resume <session-id>");
      this.broadcast({ type: "system", data: { message: lines.join("\n") } });
      this.broadcast({ type: "command_done", data: null });
      return;
    }

    // Resolve target session (by index or session ID)
    let targetId = args.trim();
    const idx = parseInt(targetId, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= sessions.length) {
      targetId = sessions[idx - 1].id;
    }

    const saved = loadSession(workDir, targetId);
    if (saved.length === 0) {
      this.broadcast({
        type: "error",
        data: { message: `Session '${targetId}' not found or empty.` },
      });
      this.broadcast({ type: "command_done", data: null });
      return;
    }

    // Rebuild conversation from saved session
    handle.conv = new ConversationManager();
    handle.sessionId = targetId;

    const replay = rebuildFromSession(saved);

    // Clear UI and replay messages
    this.broadcast({ type: "clear", data: null });
    for (const msg of replay) {
      if (msg.role === "user") {
        handle.conv.addUserMessage(msg.content);
        this.broadcast({ type: "replay_user", data: { content: msg.content } });
      } else if (msg.role === "assistant") {
        handle.conv.addAssistantMessage(msg.content);
        this.broadcast({
          type: "replay_assistant",
          data: { content: msg.content },
        });
      }
    }

    this.broadcast({
      type: "system",
      data: {
        message: `Session ${targetId} restored (${String(replay.length)} messages).`,
      },
    });
    this.broadcast({ type: "command_done", data: null });
  }

  // -- Helper methods -----------------------------------------------------------

  /** Creates the askUser callback closure for createRemoteAgent. */
  private createAskUserCallback(): Asker {
    return async (questions: Question[]): Promise<Record<string, string>> => {
      const id = `ask_${Date.now().toString(36)}`;
      this.broadcast({ type: "ask_user", data: { id, questions } });
      return new Promise((resolve) => {
        this.pendingAsks.set(id, resolve);
      });
    };
  }

  /** Creates the onPermissionRequest callback for agent runs. */
  private createPermissionCallback(): RunCallbacks["onPermissionRequest"] {
    return async (
      toolName: string,
      args: Record<string, unknown>,
      decision: Decision,
    ): Promise<"allow" | "deny" | "allowAlways"> => {
      const id = `perm_${Date.now().toString(36)}`;
      const desc = formatPermissionDesc(toolName, args, decision);
      this.broadcast({
        type: "permission_request",
        data: { id, toolName, description: desc },
      });
      return new Promise((resolve) => {
        this.pendingPermissions.set(id, resolve);
      });
    };
  }

  /** Builds the slash command list for the frontend's autocomplete. */
  private buildCommandList(): { name: string; description: string }[] {
    if (!this.agentHandle) {
      // Fallback: return default commands before agent init
      const defaultReg = createCommandRegistry();
      return defaultReg.listCommands().map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
      }));
    }
    return this.agentHandle.cmdRegistry.listCommands().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }

  /** Sends a JSON message to a single WebSocket client. */
  private send(ws: WebSocket, msg: WsOutbound): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // Send failure: connection will be cleaned up on close
      }
    }
  }

  /** Broadcasts a message to all connected WebSocket clients. */
  private broadcast(msg: WsOutbound): void {
    if (this.clients.size === 0) {
      return;
    }
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
        } catch {
          // Send failure: connection will be cleaned up on close
        }
      }
    }
  }

  /**
   * Starts the Koa HTTP + WebSocket server.
   * Initializes the agent handle eagerly; falls back to lazy init on first message.
   */
  async run(): Promise<void> {
    // Attempt eager agent initialization
    try {
      this.agentHandle = await createRemoteAgent({
        provider: this.opts.providers[0],
        workDir: cwd(),
        hooks: this.opts.hookConfigs,
        mcpServers: this.opts.mcpServers,
        askUser: this.createAskUserCallback(),
      });
      log.info({ sessionId: this.agentHandle.sessionId }, "agent initialized");
    } catch (err) {
      log.warn({ err }, "agent init deferred -- will retry on first message");
      this.agentHandle = null;
    }

    // Parse listen address
    const parts = this.opts.addr.split(":");
    const host = parts[0] || "0.0.0.0";
    const port = parseInt(parts[1] ?? "18888", 10);

    return new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(port, host, () => {
        log.info({ host, port }, "Koa server listening");
        log.info({ host, port }, "WebSocket server ready");
        resolve();
      });
    });
  }

  /** Stops the server and cleans up all connections. */
  stop(): void {
    for (const ws of this.clients) {
      ws.close();
    }
    this.clients.clear();
    this.wss.close();
    this.server.close();
  }
}
