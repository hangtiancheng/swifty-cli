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

// swifty-core daemon entry: load config, start TCP server, register handlers, wait for shutdown signal
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";

import picomatch from "picomatch";

import { version } from "../version.js";
import { eventsFile } from "./runs.js";
import {
  AgentRunCommandSchema,
  AgentRunResultSchema,
  EventSubscribeCommandSchema,
  EventSubscribeResultSchema,
  PermissionRespondCommandSchema,
  PermissionRespondResultSchema,
  PongResultSchema,
  SessionCloseCommandSchema,
  SessionCloseResultSchema,
  SessionCompactCommandSchema,
  SessionCreateCommandSchema,
  SessionCreateResultSchema,
  SessionGetHistoryCommandSchema,
  SessionGetHistoryResultSchema,
  SessionSendMessageCommandSchema,
  SessionSendMessageResultSchema,
} from "./bus/commands.js";
import { getConfig, expandUser } from "./config.js";
import type { Event } from "./bus/events.js";
import { EventBus } from "./events/bus.js";
import { setupLogging } from "./logging.js";
import { McpServerManager } from "./mcp/server.js";
import { PermissionManager } from "./permissions/manager.js";
import { newRunId } from "./runs.js";
import { SessionManager } from "./session/manager.js";
import { SessionStore } from "./session/store.js";
import { getConnectionWriter, SocketServer } from "./transport/socket-server.js";
import { IpcEventBroadcaster } from "./transport/ipc-broadcaster.js";
import { makeEventTrace } from "./trace/record.js";
import { TraceWriter } from "./trace/writer.js";
import { AgentRunner } from "./runner.js";
import { AnthropicProvider } from "./llm/provider.js";

function now(): string {
  return new Date().toISOString();
}

// Type guard: narrow unknown to Record<string, unknown>
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class CoreApp {
  private _startTime = performance.now();
  private _bus = new EventBus();
  private _broadcaster: IpcEventBroadcaster | null = null;
  private _trace: TraceWriter | null = null;
  private _sessions: SessionManager | null = null;
  private _permissionManager: PermissionManager | null = null;
  private _mcpManager: McpServerManager | null = null;
  private _runningRuns = new Set<Promise<unknown>>();
  private _abortController = new AbortController();

  // Handle core.ping request
  private async _pingHandler(params: Record<string, unknown>): Promise<unknown> {
    await Promise.resolve();
    console.debug(`ping from ${String(params["client"])}`);
    const uptimeMs = Math.round(performance.now() - this._startTime);
    return PongResultSchema.parse({
      server_version: version,
      uptime_ms: uptimeMs,
      received_at: now(),
    });
  }

  // Write EventBus events to trace log
  private async _traceEventHandler(event: Event): Promise<void> {
    await Promise.resolve();
    if (!this._trace) return;
    const runId = "run_id" in event ? event.run_id : null;
    this._trace.emit(makeEventTrace(runId, { ...event }));
  }

  // agent.run handler
  private async _agentRunHandler(params: Record<string, unknown>): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = AgentRunCommandSchema.parse(params);
    const session = await this._sessions.create("one_shot", cmd.goal.slice(0, 40));
    const rid = newRunId();
    const runPromise = this._sessions.sendMessage(session.id, cmd.goal, rid);
    this._runningRuns.add(runPromise);
    void runPromise.finally(() => this._runningRuns.delete(runPromise));
    return AgentRunResultSchema.parse({ run_id: rid });
  }

  // session.create handler
  private async _sessionCreateHandler(params: Record<string, unknown>): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionCreateCommandSchema.parse(params);
    const session = await this._sessions.create(cmd.mode, cmd.title);
    return SessionCreateResultSchema.parse({
      session_id: session.id,
      status: session.status,
    });
  }

  // session.send_message handler
  private async _sessionSendHandler(params: Record<string, unknown>): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionSendMessageCommandSchema.parse(params);
    const rid = await this._sessions.sendMessage(cmd.session_id, cmd.content);
    return SessionSendMessageResultSchema.parse({ run_id: rid });
  }

  // session.get_history handler
  private _sessionHistoryHandler(params: Record<string, unknown>): unknown {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionGetHistoryCommandSchema.parse(params);
    const messages = this._sessions.getHistory(cmd.session_id);
    return SessionGetHistoryResultSchema.parse({ messages });
  }

  // session.close handler
  private async _sessionCloseHandler(params: Record<string, unknown>): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionCloseCommandSchema.parse(params);
    await this._sessions.close(cmd.session_id);
    return SessionCloseResultSchema.parse({ status: "closed" });
  }

  // permission.respond handler
  private async _permissionRespondHandler(params: Record<string, unknown>): Promise<unknown> {
    await Promise.resolve();
    const cmd = PermissionRespondCommandSchema.parse(params);
    console.log(
      `permission.respond received tool_use_id=${cmd.tool_use_id} decision=${cmd.decision}`,
    );
    if (!this._permissionManager) {
      console.error("permission.respond: PermissionManager not initialized");
      return PermissionRespondResultSchema.parse({ ok: true });
    }
    this._permissionManager.respond(cmd.tool_use_id, cmd.decision);
    return PermissionRespondResultSchema.parse({ ok: true });
  }

  // session.compact handler
  private async _sessionCompactHandler(params: Record<string, unknown>): Promise<unknown> {
    if (!this._sessions) throw new Error("sessions not initialized");
    const cmd = SessionCompactCommandSchema.parse(params);
    const result = await this._sessions.compact(cmd.session_id, cmd.focus);
    return {
      summary_tokens: result.summaryTokens,
      saved_tokens: result.savedTokens,
    };
  }

  // event.subscribe handler
  // B-11: snapshot replay lines synchronously, subscribe synchronously (no
  // await gap), then write the snapshot out — see handleEventSubscribe
  private _subscribeHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = EventSubscribeCommandSchema.parse(params);
    const writer = getConnectionWriter();
    if (!this._broadcaster) throw new Error("broadcaster not initialized");
    return handleEventSubscribe(this._broadcaster, writer, cmd);
  }

  // Start the daemon
  async run(): Promise<void> {
    this._startTime = performance.now();
    const config = getConfig();
    const logger = setupLogging(config);

    // Trace
    if (config.trace.enabled) {
      const tracePath = expandUser(config.trace.file);
      this._trace = new TraceWriter(tracePath);
      this._trace.start();
      this._bus.subscribe((e) => this._traceEventHandler(e));
    }

    // Permission
    const policyPath = path.join(homedir(), ".swifty", "policy.toml");
    this._permissionManager = new PermissionManager({
      policyFile: policyPath,
      timeoutS: config.permission.timeoutS,
    });

    // Broadcaster
    this._broadcaster = new IpcEventBroadcaster(this._trace ? { trace: this._trace } : undefined);
    this._bus.subscribe(async (e) => {
      if (this._broadcaster) {
        await this._broadcaster.handle(e);
      }
    });

    // Session
    const sessionsRoot = path.join(homedir(), ".swifty", "sessions");
    const store = new SessionStore(sessionsRoot);

    // LLM provider for compaction
    const provider = new AnthropicProvider(config.llm.defaultModel);

    // MCP
    this._mcpManager = new McpServerManager();
    if (config.mcp.servers.length > 0) {
      await this._mcpManager.startAll(config.mcp.servers);
    }

    this._sessions = new SessionManager(
      store,
      () =>
        new AgentRunner(config, {
          bus: this._bus,
          ...(this._trace ? { trace: this._trace } : {}),
          ...(this._permissionManager ? { permissionManager: this._permissionManager } : {}),
          ...(this._mcpManager ? { mcpManager: this._mcpManager } : {}),
          signal: this._abortController.signal,
        }),
      this._bus,
      provider,
    );

    // Server
    const server = new SocketServer(config.host, config.port, {
      ...(this._trace ? { trace: this._trace } : {}),
      // Clean up broadcaster subscriptions when a client disconnects,
      // otherwise dead sockets accumulate in the subscription list.
      onDisconnect: (socket) => {
        // Order matters: unsubscribe first so subscriptionCount() reflects
        // the post-disconnect state before we decide whether to cancel.
        this._broadcaster?.unsubscribe(socket);
        // B-3: if the last subscriber is gone, nobody is left to answer
        // pending permission requests — cancel them all instead of letting
        // the agent freeze until the permission timeout. With multiple
        // clients (e.g. a TUI plus a CLI) remaining subscribers can still
        // answer, so we keep the requests pending.
        if (this._broadcaster?.subscriptionCount() === 0) {
          this._permissionManager?.cancelAll("client_disconnected");
        }
      },
    });
    server.register("core.ping", (p) => this._pingHandler(p));
    server.register("agent.run", (p) => this._agentRunHandler(p));
    server.register("event.subscribe", (p) => this._subscribeHandler(p));
    server.register("session.create", (p) => this._sessionCreateHandler(p));
    server.register("session.send_message", (p) => this._sessionSendHandler(p));
    server.register("session.get_history", (p) => Promise.resolve(this._sessionHistoryHandler(p)));
    server.register("session.close", (p) => this._sessionCloseHandler(p));
    server.register("permission.respond", (p) => this._permissionRespondHandler(p));
    server.register("session.compact", (p) => this._sessionCompactHandler(p));

    let addr: string;
    try {
      addr = await server.start();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = isRecord(e) && typeof e["code"] === "string" ? e["code"] : "";
      if (code === "EADDRINUSE" || msg.includes("already running")) {
        console.error(
          `swifty-core: port ${String(config.port)} already in use (${config.host}:${String(config.port)})`,
        );
      } else {
        console.error(`swifty-core: failed to start on ${config.host}:${String(config.port)}: ${msg}`);
      }
      process.exit(1);
    }
    logger.info(`swifty-core ${version} listening addr=${addr}`);

    // Wait for SIGINT/SIGTERM
    let shutdownResolve: (() => void) | undefined;
    const shutdownPromise = new Promise<void>((resolve) => {
      shutdownResolve = resolve;
    });
    const onSignal = (): void => {
      this._abortController.abort();
      shutdownResolve?.();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    await shutdownPromise;

    logger.info("shutting down");

    // Wait for running agent runs to complete (with 5s timeout)
    if (this._runningRuns.size > 0) {
      await Promise.race([
        Promise.allSettled(this._runningRuns),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            resolve();
          }, 5000),
        ),
      ]);
    }

    if (this._mcpManager) {
      await this._mcpManager.stopAll();
    }
    await server.stop();
    if (this._trace) await this._trace.stop();

    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

// Return the full path to the events.jsonl file for a given run ID
// Resolves relative paths against the swifty working directory
function eventsFilePath(runId: string): string {
  const rel = eventsFile(runId);
  return path.resolve(rel);
}

// Check whether an event type matches any of the subscribed topic patterns
// Uses picomatch with the same semantics as IpcEventBroadcaster so replayed
// events and live subscriptions match identically (e.g. "run.*", "*", "tool.call_*")
function matchTopic(eventType: string, matchers: picomatch.Matcher[]): boolean {
  return matchers.some((m) => m(eventType));
}

// Synchronously snapshot matching replay lines (event envelopes, one JSON line
// each, "\n"-terminated) from the run's events.jsonl history file.
// Fully synchronous so callers can subscribe immediately after snapshotting
// without an await gap (B-11).
export function snapshotReplayLines(runId: string, topics: string[]): string[] {
  let eventsPath = eventsFilePath(runId);

  // Fallback: search under ~/.swifty/sessions/*/runs/{runId}/events.jsonl
  if (!existsSync(eventsPath)) {
    const sessionsDir = path.join(homedir(), ".swifty", "sessions");
    if (existsSync(sessionsDir)) {
      try {
        const sessionIds = readdirSync(sessionsDir);
        for (const sessionId of sessionIds) {
          const candidate = path.join(sessionsDir, sessionId, "runs", runId, "events.jsonl");
          if (existsSync(candidate)) {
            eventsPath = candidate;
            break;
          }
        }
      } catch {
        // Ignore errors reading sessions directory
      }
    }
  }

  return snapshotReplayLinesFromFile(eventsPath, topics);
}

// Synchronously read an events.jsonl file and return the topic-matching
// event envelope lines ("\n"-terminated); empty array on any read error
export function snapshotReplayLinesFromFile(eventsPath: string, topics: string[]): string[] {
  if (!existsSync(eventsPath)) return [];

  // Compile topic matchers once (same picomatch semantics as IpcEventBroadcaster)
  const matchers = topics.map((t) => picomatch(t));

  const out: string[] = [];
  try {
    const content = readFileSync(eventsPath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) continue;
        const event = parsed;
        const eventType = typeof event["type"] === "string" ? event["type"] : "";
        if (!matchTopic(eventType, matchers)) continue;
        out.push(JSON.stringify({ kind: "event", event }) + "\n");
      } catch {
        // Skip malformed JSON lines
      }
    }
    return out;
  } catch {
    return [];
  }
}

// event.subscribe implementation, extracted for testability.
// B-11: take a synchronous snapshot of the replay lines first, then subscribe
// synchronously (no await gap between snapshot and subscribe), and only then
// write the snapshot to the socket. Events published after the subscription is
// registered are therefore never lost. Note: live events arriving while the
// snapshot is being written out may interleave with replay lines — acceptable
// for a personal tool.
export async function handleEventSubscribe(
  broadcaster: IpcEventBroadcaster,
  writer: net.Socket,
  cmd: { topics: string[]; scope: string; replay_from_run: string | null },
  snapshotFn: (runId: string, topics: string[]) => string[] = snapshotReplayLines,
): Promise<unknown> {
  // 1. Synchronous snapshot of history
  let replayLines: string[] = [];
  if (cmd.replay_from_run !== null) {
    replayLines = snapshotFn(cmd.replay_from_run, cmd.topics);
  }

  // 2. Synchronous subscribe — live events from here on are delivered
  const subId = broadcaster.subscribe(writer, cmd.topics, cmd.scope);

  // 3. Write the snapshot out (may await drain under backpressure)
  for (const line of replayLines) {
    writer.write(line);
  }
  if (replayLines.length > 0 && writer.writableNeedDrain) {
    await new Promise<void>((resolve) => writer.once("drain", resolve));
  }

  return EventSubscribeResultSchema.parse({
    subscription_id: subId,
    replayed_count: replayLines.length,
  });
}

// Daemon entry point
async function main(): Promise<void> {
  await new CoreApp().run();
  process.exit(0);
}

const isDirectRun = process.argv[1].endsWith("/app.ts") || process.argv[1].endsWith("/app.js");

if (isDirectRun) {
  void main();
}
