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
