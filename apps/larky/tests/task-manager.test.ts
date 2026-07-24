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
import { TaskManager } from "../src/core/task/manager.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("TaskManager", () => {
  // Feature: Verify creating a new task assigns incrementing IDs
  // Design: Create multiple tasks, confirm IDs are sequential integers as strings
  test("create assigns incrementing IDs", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const task1 = manager.create("Task 1", "Description 1");
    const task2 = manager.create("Task 2", "Description 2");
    expect(Number(task2.id)).toBeGreaterThan(Number(task1.id));
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify get returns task by ID
  // Design: Create task, retrieve by ID, confirm it's the same task
  test("get returns task by ID", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const created = manager.create("Test Task", "Test Description");
    const retrieved = manager.get(created.id);
    expect(retrieved?.subject).toBe("Test Task");
    expect(retrieved?.description).toBe("Test Description");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify get returns null for non-existent task
  // Design: Query non-existent ID, confirm null is returned
  // Feature: Verify get throws for non-existent task (matches Python ValueError behavior)
  // Design: Assert manager.get throws Error with "not found" message for unknown ID
  test("get throws for non-existent task", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    expect(() => manager.get("999")).toThrow(/task 999 not found/);
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify list returns all tasks
  // Design: Create multiple tasks, call list(), confirm all are returned
  test("list returns all tasks", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    manager.create("Task 1", "Desc 1");
    manager.create("Task 2", "Desc 2");
    manager.create("Task 3", "Desc 3");
    const tasks = manager.list();
    expect(tasks.length).toBe(3);
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify update changes task status
  // Design: Create task, update status to in_progress, confirm change persisted
  test("update changes task status", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const task = manager.create("Task", "Description");
    const updated = manager.update(task.id, { status: "in_progress" });
    expect(updated?.status).toBe("in_progress");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify tasks are persisted to disk
  // Design: Create task, create new manager instance with same dir, confirm task is loaded
  test("tasks persisted to disk", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager1 = new TaskManager(dir);
    const created = manager1.create("Persisted Task", "Persisted Description");

    const manager2 = new TaskManager(dir);
    const retrieved = manager2.get(created.id);
    expect(retrieved?.subject).toBe("Persisted Task");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify blockedBy dependencies are tracked
  // Design: Create two tasks, set second as blocked by first, confirm dependency recorded
  test("blockedBy dependencies tracked", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const task1 = manager.create("Task 1", "Desc 1");
    const task2 = manager.create("Task 2", "Desc 2");
    const updated = manager.update(task2.id, {
      addBlockedBy: [Number(task1.id)],
    });
    expect(updated?.blockedBy).toContain(task1.id);
    rmSync(dir, { recursive: true });
  });

  // Feature (B-13): addBlockedBy rejects self-reference
  // Design: Update a task to be blocked by its own id, expect error and
  //         unchanged blockedBy on disk
  test("addBlockedBy rejects self-reference", () => {
    const dir = path.join(tmpdir(), `test-tasks-self-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const task = manager.create("Task", "Description");
    expect(() => manager.update(task.id, { addBlockedBy: [task.id] })).toThrow(
      "task cannot block itself",
    );
    // Numeric self-id form is rejected too
    expect(() => manager.update(task.id, { addBlockedBy: [Number(task.id)] })).toThrow(
      "task cannot block itself",
    );
    // Task on disk is unchanged
    expect(manager.get(task.id).blockedBy).toEqual([]);
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify update throws for invalid status (matches Python ValueError behavior)
  // Design: Create task, update with bogus status, expect Error and unchanged task on disk
  test("update throws for invalid status", () => {
    const dir = path.join(tmpdir(), `test-tasks-invalid-status-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const task = manager.create("Task", "Description");
    expect(() => manager.update(task.id, { status: "done" })).toThrow(/invalid status: done/);
    // Task on disk is unchanged
    expect(manager.get(task.id).status).toBe("pending");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify ID sequences are per-directory, not shared across manager instances
  // Design: Two managers on two fresh dirs both start their IDs at 1
  test("ID sequence is not shared across TaskManager instances", () => {
    const dirA = path.join(tmpdir(), `test-tasks-a-${String(Date.now())}`);
    const dirB = path.join(tmpdir(), `test-tasks-b-${String(Date.now())}`);
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const managerA = new TaskManager(dirA);
    managerA.create("A1");
    managerA.create("A2");
    const managerB = new TaskManager(dirB);
    const b1 = managerB.create("B1");
    expect(b1.id).toBe("1");
    rmSync(dirA, { recursive: true });
    rmSync(dirB, { recursive: true });
  });

  // Feature: Verify operations read from disk on demand (external changes are visible)
  // Design: Write a task file directly to disk after manager construction; get/list see it
  test("external disk modifications are visible", () => {
    const dir = path.join(tmpdir(), `test-tasks-external-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    manager.create("Existing");

    writeFileSync(
      path.join(dir, "task_7.json"),
      JSON.stringify({
        id: "7",
        subject: "External",
        description: "",
        status: "in_progress",
        blockedBy: [],
        blocks: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      "utf-8",
    );

    expect(manager.get("7").subject).toBe("External");
    expect(manager.list().map((t) => t.id)).toContain("7");
    // Next created ID continues after the externally added max ID
    expect(manager.create("Next").id).toBe("8");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify legacy snake_case task files are readable (Python compatibility)
  // Design: Write file with blocked_by/created_at/updated_at and numeric id; confirm load
  test("loads legacy snake_case task files", () => {
    const dir = path.join(tmpdir(), `test-tasks-legacy-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "task_3.json"),
      JSON.stringify({
        id: 3,
        subject: "Legacy",
        description: "old format",
        status: "in_progress",
        blocked_by: [1, 2],
        blocks: [],
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-02T00:00:00.000Z",
      }),
      "utf-8",
    );
    const manager = new TaskManager(dir);
    const task = manager.get(3);
    expect(task.id).toBe("3");
    expect(task.subject).toBe("Legacy");
    expect(task.status).toBe("in_progress");
    expect(task.blockedBy).toEqual(["1", "2"]);
    expect(task.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(task.updatedAt).toBe("2025-01-02T00:00:00.000Z");
    rmSync(dir, { recursive: true });
  });
});
