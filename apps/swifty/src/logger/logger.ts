// Root logger singleton: initLogger() / getLogger() / closeLogger().
//
// Design:
// - pino.destination(fd) writes synchronously, no worker thread, compatible
//   with tsup noExternal bundling.
// - Always writes to a file fd, never stdout (Ink owns stdout in TUI mode;
//   teammate uses stdout for IPC).
// - Before initLogger(), a Proxy falls back to a silent pino logger so early
//   log calls are safe no-ops (startup errors should use console.error).
// - At serialize time, AsyncLocalStorage context (agentName, etc.) is merged.

import pino, { type Logger, type LoggerOptions } from "pino";
import { openSync, closeSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { errSerializer } from "./serializers.js";
import { getLogContext } from "./context.js";

/** Execution mode, written into the base field of every log entry. */
export type LoggerMode = "tui" | "remote" | "teammate";

/** Options for initLogger. Named to avoid clashing with pino's LoggerOptions. */
export interface InitLoggerOptions {
  /** Session ID, used as the log filename and a base field. */
  sessionId: string;
  /** Execution mode. */
  mode: LoggerMode;
  /** Working directory; defaults .swifty/logs/ root. */
  workDir?: string;
  /** Override log directory (external teammates use .swifty/teams/<team>/logs/). */
  logDir?: string;
  /** Subprocess passes true to skip expired-log cleanup (avoid multi-process races). */
  skipCleanup?: boolean;
}

/** Default log level; overridable via SWIFTY_LOG_LEVEL. */
const DEFAULT_LEVEL = "info";

let currentLogger: Logger | null = null;
let currentDest: ReturnType<typeof pino.destination> | null = null;
let currentFd: number | null = null;

/** Resolve log level: env var > default info. */
function resolveLevel(): string {
  const envLevel = process.env.SWIFTY_LOG_LEVEL;
  if (envLevel) {
    return envLevel;
  }
  return DEFAULT_LEVEL;
}

/** Compute the log file path. */
function resolveLogPath(opts: InitLoggerOptions): string {
  const dir = opts.logDir ?? join(opts.workDir ?? process.cwd(), ".swifty", "logs");
  return join(dir, `${opts.sessionId}.jsonl`);
}

/** Sanitize a filename segment to prevent path traversal (member names, etc.). */
export function sanitizeNameSegment(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned || "unnamed";
}

/** Flush a pino destination via Reflect.get, avoiding type assertions. */
function flushDestination(dest: unknown): void {
  if (typeof dest !== "object" || dest === null) {
    return;
  }
  // Reflect.get returns `any`; annotate unknown so typeof narrows to Function.
  const fn: unknown = Reflect.get(dest, "flushSync");
  if (typeof fn === "function") {
    fn.call(dest);
  }
}

/**
 * Initialize the root logger. Creates the log file, opens the fd, and builds
 * the pino instance. When called by the main process (skipCleanup defaults
 * false), also triggers expired-log cleanup.
 */
export function initLogger(opts: InitLoggerOptions): Logger {
  // Guard against fd leak on re-init.
  if (currentLogger) {
    closeLogger();
  }

  const logPath = resolveLogPath(opts);
  mkdirSync(dirname(logPath), { recursive: true });
  // Append mode: multi-process safe, supports resume.
  const fd = openSync(logPath, "a");
  currentFd = fd;
  currentDest = pino.destination(fd);

  const pinoOpts: LoggerOptions = {
    level: resolveLevel(),
    base: { sessionId: opts.sessionId, mode: opts.mode },
    serializers: { err: errSerializer },
  };

  currentLogger = pino(pinoOpts, currentDest);

  // Main-process startup: clean expired logs.
  if (!opts.skipCleanup) {
    const workDir = opts.workDir ?? process.cwd();
    void import("./cleanup.js")
      .then(({ cleanExpiredLogs }) => cleanExpiredLogs(workDir))
      .catch(() => {
        // Cleanup failure is non-fatal.
      });
  }

  return currentLogger;
}

/** Return the current logger instance, or null if not initialized. */
export function getLogger(): Logger | null {
  return currentLogger;
}

/**
 * Flush and close the fd. Registered on process.on('exit') to ensure the
 * SonicBoom internal buffer is written to disk.
 */
export function closeLogger(): void {
  if (currentLogger) {
    try {
      currentLogger.flush();
    } catch {
      // Flush failure is non-fatal
    }
    currentLogger = null;
  }
  if (currentDest) {
    flushDestination(currentDest);
    currentDest = null;
  }
  if (currentFd !== null) {
    try {
      closeSync(currentFd);
    } catch {
      // Ignore
    }
    currentFd = null;
  }
}

/**
 * Merge AsyncLocalStorage context into bindings. Called by the logger when
 * writing, so in-process subagent tool logs automatically carry agentName.
 */
export function mergeContext(bindings: Record<string, unknown>): Record<string, unknown> {
  const ctx = getLogContext();
  return { ...ctx, ...bindings };
}

// A real silent pino logger used as the Proxy target. Its methods are never
// actually called — the handler intercepts all property access and forwards
// to the current logger. Using a real Logger instance as the target gives us
// the correct return type without type assertions.
const proxyTarget = pino({ level: "silent" });

/**
 * Global logger export. Modules can import and use it at file top level:
 * ```ts
 * import { logger } from "../logger/index.js";
 * logger.info({ module: "app" }, "session started");
 * ```
 * Before initLogger(), calls fall back to the silent target (pre-init logs
 * are discarded; startup errors should use console.error directly).
 */
export const logger: Logger = new Proxy(proxyTarget, {
  get(_target, prop, receiver) {
    const current = getLogger();
    const target = current ?? _target;
    // Reflect.get returns `any`; annotate unknown so typeof narrows correctly.
    const value: unknown = Reflect.get(target, prop, receiver);
    if (typeof value === "function") {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return value.bind(target);
    }
    return value;
  },
});
