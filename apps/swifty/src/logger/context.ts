// AsyncLocalStorage context: lets in-process subagent tool logs automatically
// carry agentName/agentKind fields without changing tool signatures.
//
// How it works: logContext.run(ctx, fn) creates a context snapshot bound to fn.
// Any async operation triggered inside fn (Promise/setTimeout/fs callbacks)
// inherits that snapshot. The logger reads logContext.getStore() at serialize
// time and merges the fields into each log entry. The single-threaded event
// loop plus async hooks guarantees concurrent subagents each read their own
// context.

import { AsyncLocalStorage } from "node:async_hooks";

/** Log context fields, injected via withLogContext, auto-merged by the logger. */
export interface LogContext {
  /** Name of the current subagent / fork / teammate-in-process. */
  agentName?: string;
  /** Agent kind, distinguishes context source. */
  agentKind?: "subagent" | "fork" | "teammate-in-process";
  /** Current tool name (for dynamic child loggers). */
  toolName?: string;
}

/** Global AsyncLocalStorage singleton. */
export const logContext = new AsyncLocalStorage<LogContext>();

/**
 * Run a callback within a log context. The callback and all async operations
 * it triggers can read ctx via logContext.getStore().
 *
 * @example
 * ```ts
 * withLogContext({ agentName: "researcher", agentKind: "subagent" }, () => {
 *   return agent.run(); // tool logs inside automatically carry agentName
 * });
 * ```
 */
export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  return logContext.run(ctx, fn);
}

/** Read the current async context's log bindings. Returns empty object if none. */
export function getLogContext(): LogContext {
  return logContext.getStore() ?? {};
}
