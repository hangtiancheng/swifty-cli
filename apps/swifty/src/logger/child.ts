// createChildLogger convenience factory.
// Each module creates a child logger at file top, carrying static fields like
// { module: "session" } plus AsyncLocalStorage context (agentName, etc.).

import pino, { type Logger } from "pino";
import { getLogger, mergeContext } from "./logger.js";

// A real silent pino logger used as the Proxy target for pre-init children.
const silentTarget = pino({ level: "silent" });

/**
 * Create a module-level child logger.
 * bindings typically holds static fields like { module: "session" };
 * AsyncLocalStorage context (agentName) is merged at access time.
 *
 * Returns a Proxy that forwards every access to the current root logger's
 * child, so it stays valid across initLogger() calls.
 */
export function createChildLogger(bindings: Record<string, unknown>): Logger {
  return new Proxy(silentTarget, {
    get(_target, prop, receiver) {
      const current = getLogger();
      if (current) {
        const child = current.child(mergeContext(bindings));
        // Reflect.get returns `any`; annotate unknown so typeof narrows correctly.
        const value: unknown = Reflect.get(child, prop, receiver);
        if (typeof value === "function") {
          // Function.bind returns `any` in lib.es5; the bound callable is
          // type-safe by construction (pino method signatures are preserved).
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return value.bind(child);
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
