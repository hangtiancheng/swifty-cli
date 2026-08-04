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

import { AsyncLocalStorage } from "node:async_hooks";
import { openSync, closeSync, mkdirSync } from "node:fs";
import { readdir, stat, unlink, access } from "node:fs/promises";
import { join, dirname } from "node:path";

import pino, { type Logger, type LoggerOptions } from "pino";

/** Execution mode, written into the base field of every log entry. */
type LoggerMode = "tui" | "remote" | "teammate";

/** Options for initLogger. Named to avoid clashing with pino's LoggerOptions. */
interface InitLoggerOptions {
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
    void cleanExpiredLogs(workDir).catch(() => {
      // Cleanup failure is non-fatal.
    });
  }

  return currentLogger;
}

/** Return the current logger instance, or null if not initialized. */
function getLogger(): Logger | null {
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
function mergeContext(bindings: Record<string, unknown>): Record<string, unknown> {
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
 * import { logger } from "../logger/logger.js";
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

// createChildLogger convenience factory.
// Each module creates a child logger at file top, carrying static fields like
// { module: "session" } plus AsyncLocalStorage context (agentName, etc.).

// A real silent pino logger used as the Proxy target for pre-init children.
const silentTarget = pino({ level: "silent" });

/**
 * Create a module-level child logger.
 * bindings typically holds static fields like { module: "session" };
 * AsyncLocalStorage context (agentName) is merged at access time.
 *
 * Returns a Proxy that forwards every access to the current root logger's
 * child, so it stays valid across initLogger() calls.
 *
 * The child pino instance is cached per (rootLogger, context) pair and only
 * rebuilt when either changes, avoiding redundant pino.child() allocations
 * on every log call.
 */
export function createChildLogger(bindings: Record<string, unknown>): Logger {
  let cachedChild: Logger | null = null;
  let cachedLogger: Logger | null = null;
  let cachedCtxKey = "";

  return new Proxy(silentTarget, {
    get(_target, prop, receiver) {
      const current = getLogger();
      if (current) {
        const ctx = mergeContext(bindings);
        const ctxKey = JSON.stringify(ctx);
        if (cachedChild === null || cachedLogger !== current || cachedCtxKey !== ctxKey) {
          cachedChild = current.child(ctx);
          cachedLogger = current;
          cachedCtxKey = ctxKey;
        }
        // Reflect.get returns `any`; annotate unknown so typeof narrows correctly.
        const value: unknown = Reflect.get(cachedChild, prop, receiver);
        if (typeof value === "function") {
          // Function.bind returns `any` in lib.es5; the bound callable is
          // type-safe by construction (pino method signatures are preserved).
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return value.bind(cachedChild);
        }
        return value;
      }
      // Pre-init: fall back to silent target.
      const fallbackValue: unknown = Reflect.get(_target, prop, receiver);
      if (typeof fallbackValue === "function") {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return fallbackValue.bind(_target);
      }
      return fallbackValue;
    },
  });
}

// Expired log cleanup. Mirrors session.ts cleanExpiredSessions:
// same directory iteration, 30-day mtime check, silent unlink failure.
// Scans .swifty/logs/ and .swifty/teams/<team>/logs/.
// All fs operations are async to avoid blocking the event loop.

/** Log retention days, matches SESSION_EXPIRY_DAYS. */
const LOG_EXPIRY_DAYS = 30;
const LOG_EXPIRY_MS = LOG_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/** Check whether a path is accessible. Returns false on any error. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Clean expired log files in a single directory. Returns count removed. Failures are silent. */
async function cleanDir(dir: string): Promise<number> {
  if (!(await pathExists(dir))) {
    return 0;
  }

  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return 0;
  }

  const now = Date.now();
  let removed = 0;
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const s = await stat(filePath);
      if (now - s.mtimeMs > LOG_EXPIRY_MS) {
        await unlink(filePath);
        removed++;
      }
    } catch {
      // Silently skip
    }
  }
  return removed;
}

/**
 * Clean expired logs. Scans the default .swifty/logs/ and all team-specific
 * .swifty/teams/<team>/logs/ directories. Only called by the main process
 * (teammate subprocesses skip via skipCleanup).
 */
async function cleanExpiredLogs(workDir: string): Promise<number> {
  let removed = 0;
  removed += await cleanDir(join(workDir, ".swifty", "logs"));

  const teamsDir = join(workDir, ".swifty", "teams");
  if (!(await pathExists(teamsDir))) {
    return removed;
  }

  let teams: string[];
  try {
    teams = await readdir(teamsDir);
  } catch {
    return removed;
  }
  for (const team of teams) {
    removed += await cleanDir(join(teamsDir, team, "logs"));
  }
  return removed;
}

/** Log context fields, injected via withLogContext, auto-merged by the logger. */
interface LogContext {
  /** Name of the current subagent / fork / teammate-in-process. */
  agentName?: string;
  /** Agent kind, distinguishes context source. */
  agentKind?: "subagent" | "fork" | "teammate-in-process";
  /** Current tool name (for dynamic child loggers). */
  toolName?: string;
}

/** Global AsyncLocalStorage singleton. */
const logContext = new AsyncLocalStorage<LogContext>();

/** Read the current async context's log bindings. Returns empty object if none. */
function getLogContext(): LogContext {
  return logContext.getStore() ?? {};
}

// Custom error serializer for pino.
// The default pino err serializer does not recurse into Error.cause chains
// and does not handle non-Error values. This module fills those gaps:
// recursive cause (max 5 levels), preserves extra fields, tolerates non-Error.

/** Serialized error shape: always has type/message/stack, optional cause + extras. */
interface SerializedError {
  type: string;
  message: string;
  stack?: string;
  cause?: SerializedError | { message: string };
  [key: string]: unknown;
}

const CAUSE_MAX_DEPTH = 5;
const RESERVED_KEYS = new Set(["name", "message", "stack", "cause"]);

/** Recursively serialize an Error instance (including its cause chain). */
function serializeErrorInstance(err: Error, depth: number): SerializedError {
  const out: SerializedError = {
    type: err.name,
    message: err.message,
    stack: err.stack,
  };

  // Recursive cause chain, guard against circular references.
  // Use getOwnPropertyDescriptor to read `cause` without type assertions
  // (Error.cause is not present on older TS lib definitions).
  const causeDescriptor = Object.getOwnPropertyDescriptor(err, "cause");
  if (causeDescriptor && depth < CAUSE_MAX_DEPTH) {
    const cause: unknown = causeDescriptor.value;
    if (cause instanceof Error) {
      out.cause = serializeErrorInstance(cause, depth + 1);
    } else if (cause !== undefined) {
      out.cause = {
        message: typeof cause === "string" ? cause : JSON.stringify(cause),
      };
    }
  }

  // Preserve extra fields (code, errno, statusCode, path, etc.) that Error
  // subclasses may attach. Read via getOwnPropertyDescriptor to avoid
  // unsafe member access on the Error type.
  for (const key of Object.keys(err)) {
    if (RESERVED_KEYS.has(key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(err, key);
    if (descriptor) {
      const fieldValue: unknown = descriptor.value;
      out[key] = fieldValue;
    }
  }

  return out;
}

/**
 * pino err serializer: tolerates Error instances and non-Error values.
 * - Error instance: recursive cause chain + preserved extra fields.
 * - string/undefined/plain object: normalized to { message, value }.
 */
function errSerializer(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return serializeErrorInstance(err, 0);
  }
  return { message: String(err), value: err };
}
