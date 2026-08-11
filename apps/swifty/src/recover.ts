// Records process lifecycle events (start, exit, crash) for post-mortem analysis.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { closeLogger, logger } from "./logger/logger.js";

const LOG_DIR = ".swifty";
const LOG_PATH = join(LOG_DIR, "crash.log");

/**
 * Appends a timestamped entry to the crash log.
 * Write failures are silently ignored so diagnostics never crash the process.
 */
export function record(text: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${text}\n`, "utf8");
  } catch {
    // Swallow write errors
  }
}

/** Records an exception with its full stack trace. `context` identifies the originating layer. */
export function recordError(context: string, error: unknown): void {
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
  record(`crash [${context}] ${stack}`);
}

let exitRecorded = false;

/**
 * Writes the exit marker; subsequent calls are no-ops.
 *
 * The TUI runs in raw mode where the `exit` event may not fire on teardown,
 * so the main flow also calls this explicitly. Whichever path arrives first wins.
 */
export function recordExit(code: number | string): void {
  if (exitRecorded) {
    return;
  }
  exitRecorded = true;
  record(`exit pid=${String(process.pid)} code=${String(code)}`);
}

/**
 * Installs crash diagnostics; call once at process startup.
 *
 * Three kinds of traces are recorded: a `start` line marks the beginning of a run;
 * an `exit` line is written by the `exit` event on graceful shutdown; and
 * `uncaughtException` / `unhandledRejection` handlers capture errors that escape
 * to the top of the event loop (which would otherwise only print to the terminal
 * and be lost once it closes). Together they determine the exit mode:
 * crash + exit → crashed; start + exit only → clean shutdown; start only → killed externally.
 */
export function recover(): void {
  record(`start pid=${String(process.pid)}`);

  process.on("uncaughtException", (err) => {
    recordError("uncaught exception", err);
    // Once a handler is registered the runtime no longer prints on its own; restore terminal output
    logger.fatal({ err }, "uncaught exception");
    process.exit(1);
  });

  // Catch async errors that escape the main loop.
  process.on("unhandledRejection", (reason) => {
    recordError("unhandled rejection", reason);
    logger.fatal({ err: reason }, "unhandled rejection");
    process.exit(1);
  });

  // Flush logs on exit.
  process.on("exit", (code) => {
    closeLogger();
    recordExit(code);
  });
}
