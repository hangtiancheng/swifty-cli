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

import { describe, expect, test } from "vitest";
import { BackgroundTaskRegistry } from "../src/core/subagent/registry.js";
import { ExecutionContext } from "../src/core/context.js";

function makeCtx(runId: string): ExecutionContext {
  return new ExecutionContext({ runId, goal: "test", maxSteps: 5 });
}

describe("BackgroundTaskRegistry", () => {
  // Feature: register stores a task entry with promise and context
  // Design: Register a task, get it back, verify entry structure
  test("register and get returns the entry", () => {
    const registry = new BackgroundTaskRegistry();
    const promise = Promise.resolve();
    const ctx = makeCtx("run-1");
    registry.register("task-1", promise, ctx);

    const entry = registry.get("task-1");
    expect(entry).toBeDefined();
    if (entry) {
      expect(entry.promise).toBe(promise);
      expect(entry.context).toBe(ctx);
    }
  });

  // Feature: get returns undefined for unknown task
  // Design: Get non-existent task, verify undefined
  test("get returns undefined for unknown task", () => {
    const registry = new BackgroundTaskRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  // Feature: remove deletes a registered task
  // Design: Register, remove, verify gone
  test("remove deletes task", () => {
    const registry = new BackgroundTaskRegistry();
    registry.register("task-1", Promise.resolve(), makeCtx("r1"));
    registry.remove("task-1");

    expect(registry.get("task-1")).toBeUndefined();
  });

  // Feature: multiple tasks can be registered independently
  // Design: Register two tasks, verify both accessible
  test("multiple tasks registered independently", () => {
    const registry = new BackgroundTaskRegistry();
    const p1 = Promise.resolve();
    const p2 = Promise.resolve();
    const c1 = makeCtx("a");
    const c2 = makeCtx("b");

    registry.register("a", p1, c1);
    registry.register("b", p2, c2);

    const entryA = registry.get("a");
    const entryB = registry.get("b");
    expect(entryA).toBeDefined();
    expect(entryB).toBeDefined();
    if (entryA && entryB) {
      expect(entryA.promise).toBe(p1);
      expect(entryB.promise).toBe(p2);
    }
  });

  // Feature: removing one task does not affect others
  // Design: Register two, remove one, verify other still present
  test("remove does not affect other tasks", () => {
    const registry = new BackgroundTaskRegistry();
    const p1 = Promise.resolve();
    const p2 = Promise.resolve();

    registry.register("a", p1, makeCtx("a"));
    registry.register("b", p2, makeCtx("b"));
    registry.remove("a");

    expect(registry.get("a")).toBeUndefined();
    const entryB = registry.get("b");
    expect(entryB).toBeDefined();
    if (entryB) {
      expect(entryB.promise).toBe(p2);
    }
  });

  // Feature: all() returns all registered entries
  // Design: Register multiple, call all(), verify all entries present
  test("all returns all entries", () => {
    const registry = new BackgroundTaskRegistry();
    registry.register("x", Promise.resolve(), makeCtx("x"));
    registry.register("y", Promise.resolve(), makeCtx("y"));

    const entries = registry.all();
    expect(entries).toHaveLength(2);
    const ids = entries.map(([id]) => id);
    expect(ids).toContain("x");
    expect(ids).toContain("y");
  });

  // Feature: re-registering same key overwrites previous
  // Design: Register twice with same key, verify second wins
  test("re-registering overwrites previous", () => {
    const registry = new BackgroundTaskRegistry();
    const p1 = Promise.resolve();
    const p2 = Promise.resolve();
    const c2 = makeCtx("task-1-v2");

    registry.register("task-1", p1, makeCtx("task-1"));
    registry.register("task-1", p2, c2);

    const entry = registry.get("task-1");
    expect(entry).toBeDefined();
    if (entry) {
      expect(entry.promise).toBe(p2);
      expect(entry.context).toBe(c2);
    }
  });

  // Feature: cancel aborts the associated AbortController for pending tasks
  // Design: Register a never-settling promise with a controller, cancel,
  // verify status flips to cancelled and the controller's signal is aborted
  test("cancel aborts the associated controller", () => {
    const registry = new BackgroundTaskRegistry();
    const controller = new AbortController();
    const never = new Promise<void>(() => undefined);

    registry.register("bg-1", never, makeCtx("bg-1"), controller);
    registry.cancel("bg-1");

    expect(controller.signal.aborted).toBe(true);
    expect(registry.get("bg-1")?.status).toBe("cancelled");
  });

  // Feature: cancel does not abort controllers of settled tasks
  // Design: Register a resolved promise, wait for settlement, cancel,
  // verify controller is not aborted and status stays fulfilled
  test("cancel is a no-op after the task settled", async () => {
    const registry = new BackgroundTaskRegistry();
    const controller = new AbortController();

    registry.register("bg-2", Promise.resolve(), makeCtx("bg-2"), controller);
    // Let the settlement callback run so status becomes fulfilled
    await Promise.resolve();
    registry.cancel("bg-2");

    expect(controller.signal.aborted).toBe(false);
    expect(registry.get("bg-2")?.status).toBe("fulfilled");
  });
});
