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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { TaskCreateTool } from "../src/core/tools/builtin/task-create.js";
import { TaskGetTool } from "../src/core/tools/builtin/task-get.js";
import { TaskListTool } from "../src/core/tools/builtin/task-list.js";
import { TaskUpdateTool } from "../src/core/tools/builtin/task-update.js";
import { TaskManager } from "../src/core/task/manager.js";
import { isRecord } from "../src/core/bus/envelope.js";

function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "swifty-test-"));
}

function parseJson(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error("expected object");
  return parsed;
}

function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function strArr(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  return Array.isArray(v) ? v.map(String) : [];
}

describe("Task Builtin Tools", () => {
  // Feature: TaskCreateTool creates a new task
  // Design: Invoke with subject, verify success and task data
  test("task_create creates task", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const tool = new TaskCreateTool(mgr);

      expect(tool.name).toBe("task_create");

      const result = await tool.invoke({
        subject: "Fix bug",
        description: "Fix the login bug",
      });
      expect(result.isError).toBe(false);

      const task = parseJson(result.content);
      expect(str(task, "subject")).toBe("Fix bug");
      expect(str(task, "description")).toBe("Fix the login bug");
      expect(str(task, "status")).toBe("pending");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskCreateTool creates task with blocked_by
  // Design: Create two tasks, second blocked by first
  test("task_create with blocked_by", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const tool = new TaskCreateTool(mgr);

      const r1 = await tool.invoke({ subject: "First" });
      const t1 = parseJson(r1.content);

      const r2 = await tool.invoke({
        subject: "Second",
        blocked_by: [Number(str(t1, "id"))],
      });
      const t2 = parseJson(r2.content);
      expect(strArr(t2, "blockedBy")).toContain(str(t1, "id"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskGetTool retrieves task by ID
  // Design: Create a task, then get it by ID
  test("task_get retrieves task", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const getTool = new TaskGetTool(mgr);

      expect(getTool.name).toBe("task_get");

      const created = await createTool.invoke({ subject: "Test" });
      const task = parseJson(created.content);

      const result = await getTool.invoke({ task_id: Number(str(task, "id")) });
      expect(result.isError).toBe(false);

      const retrieved = parseJson(result.content);
      expect(str(retrieved, "subject")).toBe("Test");
      expect(str(retrieved, "id")).toBe(str(task, "id"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskListTool returns formatted task list
  // Design: Create tasks, list them, verify format
  test("task_list returns formatted output", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const listTool = new TaskListTool(mgr);

      expect(listTool.name).toBe("task_list");

      await createTool.invoke({ subject: "Task A" });
      await createTool.invoke({ subject: "Task B" });

      const result = await listTool.invoke({});
      expect(result.isError).toBe(false);
      expect(result.content).toContain("Task A");
      expect(result.content).toContain("Task B");
      expect(result.content).toContain("[pending]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskListTool returns 'No tasks.' when empty
  // Design: List with no tasks, verify empty message
  test("task_list returns empty message when no tasks", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const listTool = new TaskListTool(mgr);

      const result = await listTool.invoke({});
      expect(result.content).toBe("No tasks.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskUpdateTool updates task status
  // Design: Create task, update to in_progress, verify change
  test("task_update changes status", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const updateTool = new TaskUpdateTool(mgr);

      expect(updateTool.name).toBe("task_update");

      const created = await createTool.invoke({ subject: "Work" });
      const task = parseJson(created.content);

      const result = await updateTool.invoke({
        task_id: Number(str(task, "id")),
        status: "in_progress",
      });
      expect(result.isError).toBe(false);

      const updated = parseJson(result.content);
      expect(str(updated, "status")).toBe("in_progress");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskUpdateTool completing task clears dependencies
  // Design: Create two tasks with dependency, complete first, verify second unblocked
  test("task_update completing clears blocked_by", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const updateTool = new TaskUpdateTool(mgr);

      const r1 = await createTool.invoke({ subject: "First" });
      const t1 = parseJson(r1.content);

      const r2 = await createTool.invoke({
        subject: "Second",
        blocked_by: [Number(str(t1, "id"))],
      });
      const t2 = parseJson(r2.content);
      expect(strArr(t2, "blockedBy")).toContain(str(t1, "id"));

      await updateTool.invoke({
        task_id: Number(str(t1, "id")),
        status: "completed",
      });

      const getTool = new TaskGetTool(mgr);
      const r3 = await getTool.invoke({ task_id: Number(str(t2, "id")) });
      const t2After = parseJson(r3.content);
      expect(strArr(t2After, "blockedBy")).not.toContain(str(t1, "id"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskUpdateTool rejects invalid status instead of silently ignoring it
  // Design: Update with bogus status, expect runtime_error result and unchanged task
  test("task_update returns error for invalid status", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const updateTool = new TaskUpdateTool(mgr);
      const getTool = new TaskGetTool(mgr);

      const created = await createTool.invoke({ subject: "Work" });
      const task = parseJson(created.content);

      const result = await updateTool.invoke({
        task_id: Number(str(task, "id")),
        status: "done",
      });
      expect(result.isError).toBe(true);
      expect(result.errorType).toBe("runtime_error");
      expect(result.content).toContain("invalid status: done");

      // Task remains unchanged
      const after = await getTool.invoke({ task_id: Number(str(task, "id")) });
      expect(str(parseJson(after.content), "status")).toBe("pending");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: Task tools accept string task IDs (schema declares integer|string)
  // Design: Pass IDs as digit strings to get/update/create, verify normalization
  test("task tools accept string task IDs", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const getTool = new TaskGetTool(mgr);
      const updateTool = new TaskUpdateTool(mgr);

      const created = await createTool.invoke({ subject: "First" });
      const t1 = parseJson(created.content);
      const id = str(t1, "id");

      const got = await getTool.invoke({ task_id: id });
      expect(got.isError).toBe(false);
      expect(str(parseJson(got.content), "id")).toBe(id);

      const updated = await updateTool.invoke({ task_id: id, status: "in_progress" });
      expect(updated.isError).toBe(false);
      expect(str(parseJson(updated.content), "status")).toBe("in_progress");

      const second = await createTool.invoke({ subject: "Second", blocked_by: [id] });
      expect(second.isError).toBe(false);
      expect(strArr(parseJson(second.content), "blockedBy")).toContain(id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: Task tools reject non-integer task IDs with schema_error
  // Design: Pass non-integer IDs, expect schema_error results
  test("task tools reject non-integer task IDs", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const getTool = new TaskGetTool(mgr);
      const updateTool = new TaskUpdateTool(mgr);

      const r1 = await getTool.invoke({ task_id: "abc" });
      expect(r1.isError).toBe(true);
      expect(r1.errorType).toBe("schema_error");

      const r2 = await updateTool.invoke({ task_id: 1.5, status: "pending" });
      expect(r2.isError).toBe(true);
      expect(r2.errorType).toBe("schema_error");

      const r3 = await createTool.invoke({ subject: "X", blocked_by: ["not-a-number"] });
      expect(r3.isError).toBe(true);
      expect(r3.errorType).toBe("schema_error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
