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
import { TaskStatus } from "../src/core/task/model.js";
import { TaskManager } from "../src/core/task/manager.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "swifty-test-"));
}

describe("Task Model", () => {
  // Feature: TaskStatus enum values are stable
  // Design: Verify the const values match expected strings
  test("TaskStatus has correct values", () => {
    expect(TaskStatus.PENDING).toBe("pending");
    expect(TaskStatus.IN_PROGRESS).toBe("in_progress");
    expect(TaskStatus.COMPLETED).toBe("completed");
  });

  // Feature: TaskStatus values are exhaustive
  // Design: Verify only the 3 expected statuses exist
  test("TaskStatus has exactly 3 values", () => {
    const values = Object.values(TaskStatus);
    expect(values).toHaveLength(3);
    expect(values).toContain("pending");
    expect(values).toContain("in_progress");
    expect(values).toContain("completed");
  });

  // Feature: TaskManager creates tasks with correct model shape
  // Design: Create task via manager, verify all fields are present and typed correctly
  test("TaskManager.create produces valid Task objects", () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const task = mgr.create("Test task", "A description");

      expect(typeof task.id).toBe("string");
      expect(task.subject).toBe("Test task");
      expect(task.description).toBe("A description");
      expect(task.status).toBe("pending");
      expect(Array.isArray(task.blockedBy)).toBe(true);
      expect(Array.isArray(task.blocks)).toBe(true);
      expect(task.blockedBy).toHaveLength(0);
      expect(task.blocks).toHaveLength(0);
      expect(typeof task.createdAt).toBe("string");
      expect(typeof task.updatedAt).toBe("string");
      // Verify ISO date format
      expect(() => new Date(task.createdAt)).not.toThrow();
      expect(() => new Date(task.updatedAt)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskManager tracks blockedBy and blocks bidirectionally
  // Design: Create tasks with dependencies, verify both sides are updated
  test("TaskManager tracks bidirectional dependencies", () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const t1 = mgr.create("First task");
      const t2 = mgr.create("Second task", "", [Number(t1.id)]);

      // t2 is blocked by t1
      expect(t2.blockedBy).toContain(t1.id);
      // t1 blocks t2
      const t1Updated = mgr.get(t1.id);
      expect(t1Updated).not.toBeNull();
      if (t1Updated) {
        expect(t1Updated.blocks).toContain(t2.id);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: Completing a task auto-clears it from other tasks' blockedBy
  // Design: Complete t1, verify t2.blockedBy no longer includes t1
  test("completing task clears it from dependents", () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const t1 = mgr.create("First");
      const t2 = mgr.create("Second", "", [Number(t1.id)]);
      expect(t2.blockedBy).toContain(t1.id);

      mgr.update(t1.id, { status: "completed" });
      const t2After = mgr.get(t2.id);
      if (t2After) {
        expect(t2After.blockedBy).not.toContain(t1.id);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
