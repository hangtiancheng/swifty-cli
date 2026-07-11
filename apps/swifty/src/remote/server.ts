// Remote server: Koa.js HTTP + WebSocket bridge for browser-based access.
// Serves the React frontend (fe/dist/) and bridges Agent events to WS.
// Ported from Go's internal/remote/server.go.

import Koa from "koa";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { cwd } from "node:process";
import z from "zod";
import type { HookConfig, MCPServerConfig, ProviderConfig } from "../config/config.js";
import type { AgentEvent } from "../agent/events.js";
import type { Question } from "../tools/ask-user.js";
import { createRemoteAgent, type RemoteAgentHandle } from "./agent-setup.js";
import { createChildLogger } from "../logger/index.js";

// Module-level child logger for remote server.
const log = createChildLogger({ module: "remote" });

interface RemoteServerOptions {
  providers: ProviderConfig[];
  mcpServers?: MCPServerConfig[];
  hookConfigs?: HookConfig[];
  addr: string;
}

// ── WS message types (match fe/src/types.ts) ──────────────────────────

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

// ── Static file serving ────────────────────────────────────────────────

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

// ── RemoteServer ───────────────────────────────────────────────────────

export class RemoteServer {
  private app: Koa;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private opts: RemoteServerOptions;

  // Agent handle — created lazily on first user_message
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
    this.app.use(async (ctx, next) => {
      // Skip /ws — handled by WebSocket server
      if (ctx.path === "/ws") {
        await next();
        return;
      }

      // Root path → index.html
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

      // Send initial connected message
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

    // Create agent lazily on first message
    if (!this.agentHandle) {
      try {
        this.agentHandle = await createRemoteAgent({
          provider: this.opts.providers[0],
          workDir: cwd(),
          hooks: this.opts.hookConfigs,
          mcpServers: this.opts.mcpServers,
        });
        // Re-send connected with the real session ID
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

    this.streaming = true;
    const startTime = Date.now();

    try {
      const callbacks = {
        onPermissionRequest: async (
          toolName: string,
          args: Record<string, unknown>,
          decision: { effect: string; reason: string },
          desc: string,
        ): Promise<"allow" | "deny" | "allowAlways"> => {
          const id = `perm_${Date.now().toString(36)}`;
          this.broadcast({
            type: "permission_request",
            data: { id, toolName, description: desc },
          });
          return new Promise((resolve) => {
            this.pendingPermissions.set(id, resolve);
          });
        },
        onAskUser: async (questions: Question[]): Promise<Record<string, string>> => {
          const id = `ask_${Date.now().toString(36)}`;
          this.broadcast({ type: "ask_user", data: { id, questions } });
          return new Promise((resolve) => {
            this.pendingAsks.set(id, resolve);
          });
        },
      };

      let streamBuf = "";
      for await (const ev of this.agentHandle.run(text, callbacks)) {
        // Flush accumulated stream text BEFORE tool_result/turn_complete/loop_complete
        // so the frontend finalizes the assistant message before rendering the tool
        // block or turn summary. Mirrors Go's consumeAgentEvents stream_end injection.
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
        this.bridgeEvent(ev, startTime, (t) => {
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

  /** Bridges an AgentEvent to the corresponding WS message. */
  private bridgeEvent(
    ev: AgentEvent,
    startTime: number,
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
      case "loop_complete":
        this.broadcast({
          type: "loop_complete",
          data: {
            totalTurns: this.turnCount,
            elapsed: (Date.now() - startTime) / 1000,
          },
        });
        break;
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
        break;
      case "retry":
        this.broadcast({
          type: "retry",
          data: { reason: ev.reason, waitMs: ev.delay },
        });
        break;
      // thinking_complete, permission_request, ask_user_question are handled
      // via callbacks, not events — no WS message needed here.
      default:
        break;
    }
  }

  /** Builds the slash command list for the frontend's autocomplete. */
  private buildCommandList(): { name: string; description: string }[] {
    return [
      { name: "help", description: "Show available commands" },
      { name: "clear", description: "Clear conversation" },
      { name: "compact", description: "Compact conversation" },
      { name: "status", description: "Show status" },
      { name: "skills", description: "List skills" },
      { name: "memory", description: "Show memory" },
      { name: "session", description: "Show session info" },
    ];
  }

  /** Sends a JSON message to a single WebSocket client. */
  private send(ws: WebSocket, msg: WsOutbound): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /** Broadcasts a message to all connected WebSocket clients. */
  private broadcast(msg: WsOutbound): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Starts the Koa HTTP + WebSocket server. Blocks until the server stops.
   * Mirrors Go's Server.Run().
   */
  run(): Promise<void> {
    return new Promise((resolve, reject) => {
      const parts = this.opts.addr.split(":");
      const host = parts[0] || "0.0.0.0";
      const port = parseInt(parts[1] ?? "18888", 10);

      this.server.listen(port, host, () => {
        log.info({ host, port }, "Koa server listening");
        log.info({ host, port }, "WebSocket server ready");
        log.info("open the URL in a browser to access the Web UI");
      });

      this.server.on("error", reject);
      this.server.on("close", resolve);
    });
  }

  /** Stops the server. */
  stop(): void {
    for (const ws of this.clients) {
      ws.close();
    }
    this.clients.clear();
    this.wss.close();
    this.server.close();
  }
}
