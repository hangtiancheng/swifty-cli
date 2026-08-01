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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import type net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import picomatch from "picomatch";

import { loadConfig as loadLarkyConfig, forkEnabled } from "../config/config.js";
import type { AppConfig } from "../config/config.js";
import { initLogger, logger } from "../logger/index.js";
import type { PermissionMode } from "../permissions/checker.js";
import * as sessionMod from "../session/session.js";
import { version } from "../version.js";

import { AgentSession } from "./agent-session.js";
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
} from "./bus/commands.js";
import { HandlerError, isRecord } from "./bus/envelope.js";
import type { Event } from "./bus/events.js";
import { getConfig, newTraceId, getTraceFilePath } from "./config.js";
import { EventBus } from "./events/bus.js";
import { InteractionHub } from "./interaction-hub.js";
import { makeEventTrace } from "./trace/record.js";
import { TraceWriter } from "./trace/writer.js";
import { IpcEventBroadcaster } from "./transport/ipc-broadcaster.js";
import { SocketServer, getConnectionWriter } from "./transport/socket-server.js";

const SESSION_NOT_FOUND = -32010;
const SESSION_BUSY = -32012;

function nowIso(): string {
  return new Date().toISOString();
}

// Events for a run are persisted here for replay_from_run.
function runEventsPath(workDir: string, runId: string): string {
  return path.join(workDir, ".larky", "daemon", "runs", runId, "events.jsonl");
}

export class CoreApp {
  private _bus = new EventBus();
  private _broadcaster: IpcEventBroadcaster | null = null;
  private _trace: TraceWriter | null = null;
  private _startTime = 0;
  private _workDir = process.cwd();
  private _larkyConfig: AppConfig | null = null;
  private _sessions = new Map<string, AgentSession>();

  private _hub = new InteractionHub(
    (e) => {
      this.emit(e);
    },
    () => (this._broadcaster?.subscriptionCount() ?? 0) > 0,
  );

  private _teammatePollTimer: ReturnType<typeof setInterval> | null = null;
  // Per-session cache: a single shared string would make two sessions with
  // different states re-broadcast teammate.state on every poll tick.
  private _lastTeammateStates = new Map<string, string>();
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;

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
  // Delegated to InteractionHub (core/interaction-hub.ts): pending maps,
  // exactly-once settlement, abort/disconnect/sess-close cancellation.

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

    const provider = cmd.provider_name
      ? (cfg.providers.find((p) => p.name === cmd.provider_name) ?? cfg.providers[0])
      : cfg.providers[0];

    const session = await AgentSession.create({
      provider,
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
      broker: this._hub,
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
    this._lastTeammateStates.delete(cmd.session_id);
    this._hub.cancelForSession(cmd.session_id);
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
    // Unknown/duplicate ids are idempotently ignored (first response wins).
    this._hub.respondPermission(cmd.id, cmd.response);
    return Promise.resolve({ ok: true });
  }

  private _askRespondHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = AskUserRespondCommandSchema.parse({
      ...params,
      type: "ask_user.respond",
    });
    this._hub.respondAsk(cmd.id, cmd.answers);
    return Promise.resolve({ ok: true });
  }

  private _planRespondHandler(params: Record<string, unknown>): Promise<unknown> {
    const cmd = PlanRespondCommandSchema.parse({
      ...params,
      type: "plan.respond",
    });
    this._hub.respondPlan(cmd.id, cmd.choice, cmd.feedback);
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
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    return handleEventSubscribe(this._broadcaster, writer, cmd, (runId, topics, offset) =>
      snapshotReplayLines(this._workDir, runId, topics, offset),
    );
  }

  // -- Idle session recycling (P2-14) -----------------------------------------

  // When no client stays connected (crash / kill -9, so session.close never
  // arrived), reclaim idle sessions after a grace period. Sessions with a
  // run in flight or pending interactions are exempt.
  private static readonly IDLE_RECYCLE_MS = 30 * 60 * 1000;

  private _armIdleRecycle(): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
    }
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      if (this._broadcaster?.subscriptionCount() !== 0) {
        return;
      }
      for (const [id, session] of [...this._sessions]) {
        if (session.isRunning || this._hub.hasPendingFor(id)) {
          continue;
        }
        this._sessions.delete(id);
        this._lastTeammateStates.delete(id);
        void session.close().catch(() => undefined);
      }
      // Busy sessions were skipped: re-arm so they are eventually reclaimed
      // (no further disconnect event will ever arrive to re-arm us).
      if (this._sessions.size > 0 && this._broadcaster.subscriptionCount() === 0) {
        this._armIdleRecycle();
      }
    }, CoreApp.IDLE_RECYCLE_MS);
    this._idleTimer.unref?.();
  }

  // -- Teammate state polling ------------------------------------------------

  private _startTeammatePolling(): void {
    this._teammatePollTimer = setInterval(() => {
      for (const session of this._sessions.values()) {
        const states = session.teamManager.getAllTeammateStates();
        const serialized = JSON.stringify(states);
        if (serialized === this._lastTeammateStates.get(session.id)) {
          continue;
        }
        this._lastTeammateStates.set(session.id, serialized);
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
    // larky file logger (used by all migrated business modules)
    initLogger({ sessionId: sessionMod.newSessionId(), mode: "remote" });

    // Trace
    if (config.trace) {
      const tracePath = getTraceFilePath(this._workDir, newTraceId());
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
          this._hub.cancelAll();
          this._armIdleRecycle();
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
    void cleanExpiredRunDirs(this._workDir).catch(() => undefined);
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

    // Owner watchdog: when spawned by a TUI (LARKY_OWNER_PID), exit if that
    // process dies without cleanup (kill -9, segfault, OOM — its exit/signal
    // handlers never ran, so no `larky core stop` will ever arrive). Other
    // clients may still be attached; defer shutdown until the last one leaves.
    let ownerWatchTimer: ReturnType<typeof setInterval> | null = null;
    const ownerPid = Number(process.env.LARKY_OWNER_PID ?? "");
    if (Number.isInteger(ownerPid) && ownerPid > 0) {
      ownerWatchTimer = setInterval(() => {
        try {
          process.kill(ownerPid, 0);
        } catch {
          if ((this._broadcaster?.subscriptionCount() ?? 0) > 0) {
            return; // owner gone but other clients attached — keep serving
          }
          logger.info(`owner pid=${String(ownerPid)} gone; shutting down`);
          shutdownResolve?.();
        }
      }, 2000);
      ownerWatchTimer.unref?.();
    }

    await shutdownPromise;

    logger.info("shutting down");
    // Hard-exit backstop: a hung session/MCP close must never zombie the
    // daemon after shutdown was decided.
    const hardExitTimer = setTimeout(() => {
      removeOwnPidFile();
      process.exit(0);
    }, 10_000);
    hardExitTimer.unref?.();
    if (ownerWatchTimer) {
      clearInterval(ownerWatchTimer);
    }
    if (this._teammatePollTimer) {
      clearInterval(this._teammatePollTimer);
    }
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    this._hub.cancelAll();
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
// without an await gap (B-11). offset skips the first N matching lines the
// client already applied before disconnecting.
export function snapshotReplayLines(
  workDir: string,
  runId: string,
  topics: string[],
  offset = 0,
): string[] {
  return snapshotReplayLinesFromFile(runEventsPath(workDir, runId), topics, offset);
}

export function snapshotReplayLinesFromFile(
  eventsPath: string,
  topics: string[],
  offset = 0,
): string[] {
  if (!existsSync(eventsPath)) {
    return [];
  }

  const matchers = topics.map((t) => picomatch(t));
  const out: string[] = [];
  let matched = 0;
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
        matched++;
        if (matched <= offset) {
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
  cmd: {
    topics: string[];
    scope: string;
    replay_from_run: string | null;
    replay_offset?: number;
  },
  snapshotFn: (runId: string, topics: string[], offset: number) => string[],
): Promise<unknown> {
  let replayLines: string[] = [];
  if (cmd.replay_from_run !== null) {
    replayLines = snapshotFn(cmd.replay_from_run, cmd.topics, cmd.replay_offset ?? 0);
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

// -- Run events cleanup (P2-17) ---------------------------------------------

// Replay logs are a short-lived reconnect cache; reclaim old run dirs on
// daemon startup (no active runs exist at that point). Keeps the most
// recent KEEP_RECENT dirs and anything younger than RUN_EXPIRY_MS.
const RUN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_RECENT_RUNS = 20;

export async function cleanExpiredRunDirs(workDir: string): Promise<number> {
  const base = path.join(workDir, ".larky", "daemon", "runs");
  let names: string[];
  try {
    const entries = await readdir(base, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return 0;
  }
  const dirs: { p: string; mtime: number }[] = [];
  for (const name of names) {
    const dirPath = path.join(base, name);
    try {
      dirs.push({ p: dirPath, mtime: (await stat(dirPath)).mtimeMs });
    } catch {
      // raced away; skip
    }
  }
  dirs.sort((a, b) => b.mtime - a.mtime);
  const now = Date.now();
  let removed = 0;
  for (const [i, d] of dirs.entries()) {
    if (i < KEEP_RECENT_RUNS || now - d.mtime <= RUN_EXPIRY_MS) {
      continue;
    }
    try {
      await rm(d.p, { recursive: true, force: true });
      removed++;
    } catch {
      // best-effort
    }
  }
  return removed;
}

// Best-effort: remove the PID file written by the CLI, but only when it still
// holds our own PID — a stale file left after self-exit is a PID-reuse hazard
// for the next `larky core stop`.
export function removeOwnPidFile(): void {
  const pidFile = path.join(homedir(), ".larky", "larky-core.pid");
  try {
    if (existsSync(pidFile) && Number(readFileSync(pidFile, "utf-8").trim()) === process.pid) {
      unlinkSync(pidFile);
    }
  } catch {
    // best effort
  }
}

// Daemon entry point
async function main(): Promise<void> {
  await new CoreApp().run();
  removeOwnPidFile();
  process.exit(0);
}

// argv[1] may be a symlink (or otherwise not literally end in app.js) —
// resolve both sides before comparing, same as cli/main.ts.
const isDirectRun = (() => {
  const argv1 = process.argv[1];
  if (!argv1) {
    return false;
  }
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  void main();
}
