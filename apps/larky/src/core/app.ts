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

// larky-core daemon: hosts the full larky agent stack behind a TCP JSON-RPC
// server. Clients (TUI / print mode) drive sessions via RPCs and receive
// progress through the event stream (with per-run events.jsonl replay).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import type net from "node:net";

import picomatch from "picomatch";

import { getConfig, expandUser } from "./config.js";
import { setupLogging } from "./logging.js";
import { version } from "../version.js";
import { EventBus } from "./events/bus.js";
import { SocketServer, getConnectionWriter } from "./transport/socket-server.js";
import { IpcEventBroadcaster } from "./transport/ipc-broadcaster.js";
import { TraceWriter } from "./trace/writer.js";
import { makeEventTrace } from "./trace/record.js";
import { HandlerError, isRecord } from "./bus/envelope.js";
import {
  PingCommandSchema,
  CoreStatusCommandSchema,
  EventSubscribeCommandSchema,
  EventSubscribeResultSchema,
  SessionCreateCommandSchema,
  SessionListCommandSchema,
  SessionResumeCommandSchema,
  SessionSendMessageCommandSchema,
  SessionCloseCommandSchema,
  RunCancelCommandSchema,
  PermissionRespondCommandSchema,
  AskUserRespondCommandSchema,
  PlanRespondCommandSchema,
  ModeSetCommandSchema,
  CommandRunCommandSchema,
  CommandListCommandSchema,
  RewindListCommandSchema,
  RewindApplyCommandSchema,
  type WirePlanChoice,
} from "./bus/commands.js";
import type { Event } from "./bus/events.js";

import { AgentSession, type InteractionBroker } from "./agent-session.js";
import { loadConfig as loadLarkyConfig, forkEnabled } from "../config/config.js";
import type { AppConfig } from "../config/config.js";
import type { Decision, PermissionMode } from "../permissions/checker.js";
import type { Question } from "../tools/ask-user.js";
import * as sessionMod from "../session/session.js";
import { initLogger } from "../logger/index.js";

const SESSION_NOT_FOUND = -32010;
const SESSION_BUSY = -32012;

function nowIso(): string {
  return new Date().toISOString();
}

// Events for a run are persisted here for replay_from_run.
function runEventsPath(workDir: string, runId: string): string {
  return path.join(workDir, ".larky", "daemon", "runs", runId, "events.jsonl");
}

interface PendingPermission {
  sessionId: string;
  resolve: (r: "allow" | "deny" | "allowAlways") => void;
}

interface PendingAsk {
  sessionId: string;
  resolve: (answers: Record<string, string>) => void;
}

interface PendingPlan {
  sessionId: string;
  resolve: (r: { choice: WirePlanChoice; feedback: string }) => void;
  reject: (e: Error) => void;
}

export class CoreApp {
  private _bus = new EventBus();
  private _broadcaster: IpcEventBroadcaster | null = null;
  private _trace: TraceWriter | null = null;
  private _startTime = 0;
  private _workDir = process.cwd();
  private _larkyConfig: AppConfig | null = null;
  private _sessions = new Map<string, AgentSession>();

  private _pendingPermissions = new Map<string, PendingPermission>();
  private _pendingAsks = new Map<string, PendingAsk>();
  private _pendingPlans = new Map<string, PendingPlan>();

  private _teammatePollTimer: ReturnType<typeof setInterval> | null = null;
  private _lastTeammateStates = "";

  // -- Event emission -------------------------------------------------------

  private emit(event: Event): void {
    void this._bus.publish(event);
  }

  // Persist run-scoped events for replay, then broadcast.
  private _persistEvent(event: Event): void {
    const runId = "run_id" in event ? event.run_id : "";
    if (!runId) {
      return;
    }
    const p = runEventsPath(this._workDir, runId);
    try {
      mkdirSync(path.dirname(p), { recursive: true });
      appendFileSync(p, JSON.stringify(event) + "\n", "utf-8");
    } catch {
      // best-effort persistence; replay simply misses these lines
    }
  }

  // -- Interaction broker -----------------------------------------------------

  private _broker: InteractionBroker = {
    requestPermission: (session, toolName, args, decision: Decision) => {
      const id = `perm-${randomUUID().slice(0, 8)}`;
      return new Promise<"allow" | "deny" | "allowAlways">((resolve) => {
        this._pendingPermissions.set(id, {
          sessionId: session.id,
          resolve: (r) => {
            resolve(r);
          },
        });
        this.emit({
          type: "permission.requested",
          id,
          session_id: session.id,
          run_id: session.currentRunId ?? "",
          tool_name: toolName,
          args,
          reason: decision.reason,
          timestamp: nowIso(),
        });
      });
    },
    askUser: (session, questions: Question[]) => {
      const id = `ask-${randomUUID().slice(0, 8)}`;
      return new Promise<Record<string, string>>((resolve) => {
        this._pendingAsks.set(id, { sessionId: session.id, resolve });
        this.emit({
          type: "ask_user.requested",
          id,
          session_id: session.id,
          run_id: session.currentRunId ?? "",
          questions: questions.map((q) => ({
            question: q.question,
            header: q.header,
            options: q.options.map((o) => ({
              label: o.label,
              ...(o.description !== undefined ? { description: o.description } : {}),
            })),
            multiSelect: q.multiSelect,
          })),
          timestamp: nowIso(),
        });
      });
    },
    requestPlanApproval: (session, planText: string) => {
      const id = `plan-${randomUUID().slice(0, 8)}`;
      return new Promise<{ choice: WirePlanChoice; feedback: string }>((resolve, reject) => {
        this._pendingPlans.set(id, {
          sessionId: session.id,
          resolve,
          reject,
        });
        this.emit({
          type: "plan.requested",
          id,
          session_id: session.id,
          plan_text: planText,
          timestamp: nowIso(),
        });
      });
    },
  };

  // Cancel all pending interactions (e.g. last client disconnected).
  private _cancelAllInteractions(): void {
    for (const [id, pending] of this._pendingPermissions) {
      pending.resolve("deny");
      this.emit({
        type: "permission.resolved",
        id,
        session_id: pending.sessionId,
        response: "deny",
        source: "disconnect",
        timestamp: nowIso(),
      });
    }
    this._pendingPermissions.clear();
    for (const [id, pending] of this._pendingAsks) {
      pending.resolve({});
      this.emit({
        type: "ask_user.resolved",
        id,
        session_id: pending.sessionId,
        timestamp: nowIso(),
      });
    }
    this._pendingAsks.clear();
    for (const [id, pending] of this._pendingPlans) {
      pending.reject(new Error("client disconnected"));
      this.emit({
        type: "plan.resolved",
        id,
        session_id: pending.sessionId,
        choice: "cancelled",
        timestamp: nowIso(),
      });
    }
    this._pendingPlans.clear();
  }

  // -- Session helpers ----------------------------------------------------------

  private _getSession(sessionId: string): AgentSession {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new HandlerError(SESSION_NOT_FOUND, `session not found: ${sessionId}`);
    }
    return session;
  }

  private _requireLarkyConfig(): AppConfig {
    this._larkyConfig ??= loadLarkyConfig();
    if (this._larkyConfig.providers.length === 0) {
      throw new HandlerError(-32020, "no LLM providers configured (.larky/config.yaml)");
    }
    return this._larkyConfig;
  }

  // -- RPC handlers ---------------------------------------------------------

  private _pingHandler(params: Record<string, unknown>): Promise<unknown> {
    PingCommandSchema.parse({ ...params, type: "core.ping" });
    return Promise.resolve({
      server_version: version,
      uptime_ms: Math.round(performance.now() - this._startTime),
      received_at: nowIso(),
    });
  }

  private _statusHandler(params: Record<string, unknown>): Promise<unknown> {
    CoreStatusCommandSchema.parse({ ...params, type: "core.status" });
    return Promise.resolve({
      server_version: version,
      uptime_ms: Math.round(performance.now() - this._startTime),
      cwd: this._workDir,
      active_sessions: this._sessions.size,
    });
  }

  private async _sessionCreateHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = SessionCreateCommandSchema.parse({
      ...params,
      type: "session.create",
    });
    const cfg = this._requireLarkyConfig();

    const permissionMode: PermissionMode | undefined =
      cmd.permission_mode ??
      (isPermissionMode(cfg.permission_mode) ? cfg.permission_mode : undefined);

    const session = await AgentSession.create({
      provider: cfg.providers[0],
      workDir: this._workDir,
      hooks: cfg.hooks,
      mcpServers: cfg.mcp_servers,
      sandboxConfig: cfg.sandbox,
      enableCoordinatorMode: cfg.enable_coordinator_mode ?? false,
      forkDisabled: !forkEnabled(cfg),
      ...(permissionMode ? { permissionMode } : {}),
      persist: cmd.persist,
      emit: (e) => {
        this.emit(e);
      },
      broker: this._broker,
    });
    this._sessions.set(session.id, session);
    this.emit({
      type: "session.created",
      session_id: session.id,
      cwd: this._workDir,
      timestamp: nowIso(),
    });
    return {
      session_id: session.id,
      cwd: this._workDir,
      permission_mode: session.permMode,
      commands: session.listCommands(),
    };
  }

  private _sessionListHandler(params: Record<string, unknown>): Promise<unknown> {
    SessionListCommandSchema.parse({ ...params, type: "session.list" });
    const sessions = sessionMod.listSessions(this._workDir).map((s) => ({
      id: s.id,
      first_message: s.firstMessage,
      message_count: s.messageCount,
      mod_time: s.modTime.toISOString(),
    }));
    return Promise.resolve({ sessions });
  }

  private _sessionResumeHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = SessionResumeCommandSchema.parse({
      ...params,
      type: "session.resume",
    });
    const session = this._getSession(cmd.session_id);
    if (session.isRunning) {
      throw new HandlerError(SESSION_BUSY, "cannot resume while a run is in progress");
    }
    try {
      const messages = session.resumeFrom(cmd.resume_id);
      return Promise.resolve({ messages });
    } catch (err) {
      throw new HandlerError(SESSION_NOT_FOUND, err instanceof Error ? err.message : String(err));
    }
  }

  private _sessionSendHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = SessionSendMessageCommandSchema.parse({
      ...params,
      type: "session.send_message",
    });
    const session = this._getSession(cmd.session_id);
    const runId = session.startRun(cmd.content);
    return Promise.resolve({ run_id: runId });
  }

  private async _sessionCloseHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = SessionCloseCommandSchema.parse({
      ...params,
      type: "session.close",
    });
    const session = this._getSession(cmd.session_id);
    this._sessions.delete(cmd.session_id);
    await session.close();
    return { ok: true };
  }

  private _runCancelHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = RunCancelCommandSchema.parse({ ...params, type: "run.cancel" });
    const session = this._getSession(cmd.session_id);
    const cancelled = session.cancel();
    return Promise.resolve({ ok: true, cancelled });
  }

  private _permissionRespondHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = PermissionRespondCommandSchema.parse({
      ...params,
      type: "permission.respond",
    });
    const pending = this._pendingPermissions.get(cmd.id);
    if (pending) {
      this._pendingPermissions.delete(cmd.id);
      pending.resolve(cmd.response);
      this.emit({
        type: "permission.resolved",
        id: cmd.id,
        session_id: pending.sessionId,
        response: cmd.response,
        source: "client",
        timestamp: nowIso(),
      });
    }
    // Unknown/duplicate ids are idempotently ignored (first response wins).
    return Promise.resolve({ ok: true });
  }

  private _askRespondHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = AskUserRespondCommandSchema.parse({
      ...params,
      type: "ask_user.respond",
    });
    const pending = this._pendingAsks.get(cmd.id);
    if (pending) {
      this._pendingAsks.delete(cmd.id);
      pending.resolve(cmd.answers);
      this.emit({
        type: "ask_user.resolved",
        id: cmd.id,
        session_id: pending.sessionId,
        timestamp: nowIso(),
      });
    }
    return Promise.resolve({ ok: true });
  }

  private _planRespondHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = PlanRespondCommandSchema.parse({
      ...params,
      type: "plan.respond",
    });
    const pending = this._pendingPlans.get(cmd.id);
    if (pending) {
      this._pendingPlans.delete(cmd.id);
      pending.resolve({ choice: cmd.choice, feedback: cmd.feedback });
      this.emit({
        type: "plan.resolved",
        id: cmd.id,
        session_id: pending.sessionId,
        choice: cmd.choice,
        timestamp: nowIso(),
      });
    }
    return Promise.resolve({ ok: true });
  }

  private _modeSetHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = ModeSetCommandSchema.parse({ ...params, type: "mode.set" });
    const session = this._getSession(cmd.session_id);
    session.setMode(cmd.mode);
    return Promise.resolve({ ok: true, mode: session.permMode });
  }

  private _commandRunHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = CommandRunCommandSchema.parse({
      ...params,
      type: "command.run",
    });
    const session = this._getSession(cmd.session_id);
    // Fire-and-forget: command output streams as system.message/command.done.
    void session.runCommand(cmd.input).catch((err: unknown) => {
      session.systemMessage(`Command failed: ${err instanceof Error ? err.message : String(err)}`);
      session.commandDone();
    });
    return Promise.resolve({ accepted: true });
  }

  private _commandListHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = CommandListCommandSchema.parse({
      ...params,
      type: "command.list",
    });
    const session = this._getSession(cmd.session_id);
    return Promise.resolve({ commands: session.listCommands() });
  }

  private _rewindListHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = RewindListCommandSchema.parse({
      ...params,
      type: "rewind.list",
    });
    const session = this._getSession(cmd.session_id);
    const snapshots = session.getSnapshots().map((s, index) => ({
      index,
      message_index: s.messageIndex,
      user_text: s.userText,
      file_count: Object.keys(s.backups).length,
      timestamp: s.timestamp,
    }));
    return Promise.resolve({ snapshots });
  }

  private _rewindApplyHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = RewindApplyCommandSchema.parse({
      ...params,
      type: "rewind.apply",
    });
    const session = this._getSession(cmd.session_id);
    try {
      const message = session.rewind(cmd.index, cmd.mode);
      session.systemMessage(message);
      return Promise.resolve({ ok: true, message });
    } catch (err) {
      throw new HandlerError(-32602, err instanceof Error ? err.message : String(err));
    }
  }

  private _subscribeHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = EventSubscribeCommandSchema.parse({
      ...params,
      type: "event.subscribe",
    });
    const writer = getConnectionWriter();
    if (!this._broadcaster) {
      throw new Error("broadcaster not initialized");
    }
    return handleEventSubscribe(this._broadcaster, writer, cmd, (runId, topics) =>
      snapshotReplayLines(this._workDir, runId, topics),
    );
  }

  // -- Teammate state polling ------------------------------------------------

  private _startTeammatePolling(): void {
    this._teammatePollTimer = setInterval(() => {
      for (const session of this._sessions.values()) {
        const states = session.teamManager.getAllTeammateStates();
        const serialized = JSON.stringify(states);
        if (serialized === this._lastTeammateStates) {
          continue;
        }
        this._lastTeammateStates = serialized;
        this.emit({
          type: "teammate.state",
          session_id: session.id,

          states: states.map((s) => ({ ...s })),
          timestamp: nowIso(),
        });
      }
    }, 500);
  }

  // -- Daemon lifecycle -----------------------------------------------------------

  async run(): Promise<void> {
    this._startTime = performance.now();
    const config = getConfig();
    const logger = setupLogging(config);

    // larky file logger (used by all migrated business modules)
    initLogger({ sessionId: sessionMod.newSessionId(), mode: "remote" });

    // Trace
    if (config.trace.enabled) {
      const tracePath = expandUser(config.trace.file);
      this._trace = new TraceWriter(tracePath);
      this._trace.start();
      this._bus.subscribe((e) => {
        this._trace?.emit(makeEventTrace("run_id" in e ? e.run_id : null, e));
        return Promise.resolve();
      });
    }

    // Run-scoped event persistence (for replay_from_run)
    this._bus.subscribe((e) => {
      this._persistEvent(e);
      return Promise.resolve();
    });

    // Broadcaster
    this._broadcaster = new IpcEventBroadcaster(this._trace ? { trace: this._trace } : undefined);
    this._bus.subscribe(async (e) => {
      if (this._broadcaster) {
        await this._broadcaster.handle(e);
      }
    });

    // Server
    const server = new SocketServer(config.host, config.port, {
      ...(this._trace ? { trace: this._trace } : {}),
      onDisconnect: (socket: net.Socket) => {
        // Order matters: unsubscribe first so subscriptionCount() reflects
        // the post-disconnect state before we decide whether to cancel.
        this._broadcaster?.unsubscribe(socket);
        // B-3: nobody left to answer pending interactions → cancel them all
        // instead of letting agents freeze forever.
        if (this._broadcaster?.subscriptionCount() === 0) {
          this._cancelAllInteractions();
        }
      },
    });
    server.register("core.ping", (p) => this._pingHandler(p));
    server.register("core.status", (p) => this._statusHandler(p));
    server.register("event.subscribe", (p) => this._subscribeHandler(p));
    server.register("session.create", (p) => this._sessionCreateHandler(p));
    server.register("session.list", (p) => this._sessionListHandler(p));
    server.register("session.resume", (p) => this._sessionResumeHandler(p));
    server.register("session.send_message", (p) => this._sessionSendHandler(p));
    server.register("session.close", (p) => this._sessionCloseHandler(p));
    server.register("run.cancel", (p) => this._runCancelHandler(p));
    server.register("permission.respond", (p) => this._permissionRespondHandler(p));
    server.register("ask_user.respond", (p) => this._askRespondHandler(p));
    server.register("plan.respond", (p) => this._planRespondHandler(p));
    server.register("mode.set", (p) => this._modeSetHandler(p));
    server.register("command.run", (p) => this._commandRunHandler(p));
    server.register("command.list", (p) => this._commandListHandler(p));
    server.register("rewind.list", (p) => this._rewindListHandler(p));
    server.register("rewind.apply", (p) => this._rewindApplyHandler(p));

    let addr: string;
    try {
      addr = await server.start();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = isRecord(e) && typeof e.code === "string" ? e.code : "";
      if (code === "EADDRINUSE" || msg.includes("already running")) {
        console.error(
          `larky-core: port ${String(config.port)} already in use (${config.host}:${String(config.port)})`,
        );
      } else {
        console.error(
          `larky-core: failed to start on ${config.host}:${String(config.port)}: ${msg}`,
        );
      }
      process.exit(1);
    }
    logger.info(`larky-core ${version} listening addr=${addr}`);
    this.emit({
      type: "core.started",
      listen_addr: addr,
      version,
      timestamp: nowIso(),
    });

    this._startTeammatePolling();

    // Wait for SIGINT/SIGTERM
    let shutdownResolve: (() => void) | undefined;
    const shutdownPromise = new Promise<void>((resolve) => {
      shutdownResolve = resolve;
    });
    const onSignal = (): void => {
      shutdownResolve?.();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    await shutdownPromise;

    logger.info("shutting down");
    if (this._teammatePollTimer) {
      clearInterval(this._teammatePollTimer);
    }
    this._cancelAllInteractions();
    for (const session of this._sessions.values()) {
      await session.close().catch(() => undefined);
    }
    this._sessions.clear();
    await server.stop();
    if (this._trace) {
      await this._trace.stop();
    }

    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

function isPermissionMode(mode: string | undefined): mode is PermissionMode {
  return (
    mode !== undefined && ["default", "acceptEdits", "plan", "bypassPermissions"].includes(mode)
  );
}

// -- event.subscribe replay helpers (kept from the original architecture) --------

function matchTopic(eventType: string, matchers: picomatch.Matcher[]): boolean {
  return matchers.some((m) => m(eventType));
}

// Synchronously snapshot matching replay lines from a run's events.jsonl.
// Fully synchronous so callers can subscribe immediately after snapshotting
// without an await gap (B-11).
export function snapshotReplayLines(workDir: string, runId: string, topics: string[]): string[] {
  return snapshotReplayLinesFromFile(runEventsPath(workDir, runId), topics);
}

export function snapshotReplayLinesFromFile(eventsPath: string, topics: string[]): string[] {
  if (!existsSync(eventsPath)) {
    return [];
  }

  const matchers = topics.map((t) => picomatch(t));
  const out: string[] = [];
  try {
    const content = readFileSync(eventsPath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) {
          continue;
        }
        const eventType = typeof parsed.type === "string" ? parsed.type : "";
        if (!matchTopic(eventType, matchers)) {
          continue;
        }
        out.push(JSON.stringify({ kind: "event", event: parsed }) + "\n");
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
// B-11: snapshot replay lines synchronously, subscribe synchronously (no await
// gap between snapshot and subscribe), then write the snapshot out. Events
// published after the subscription is registered are therefore never lost.
export async function handleEventSubscribe(
  broadcaster: IpcEventBroadcaster,
  writer: net.Socket,
  cmd: { topics: string[]; scope: string; replay_from_run: string | null },
  snapshotFn: (runId: string, topics: string[]) => string[],
): Promise<unknown> {
  let replayLines: string[] = [];
  if (cmd.replay_from_run !== null) {
    replayLines = snapshotFn(cmd.replay_from_run, cmd.topics);
  }

  const subId = broadcaster.subscribe(writer, cmd.topics, cmd.scope);

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
