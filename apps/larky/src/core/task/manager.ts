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

// TaskManager: file-based task CRUD with dependency tracking.
// All operations read from / write to disk on demand (no in-memory cache),
// so external modifications to the task directory are always visible.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Task } from "./model.js";
import { isRecord } from "../bus/envelope.js";

function now(): string {
  return new Date().toISOString();
}

export class TaskManager {
  private _dir: string;

  constructor(dir: string) {
    this._dir = dir;
    mkdirSync(this._dir, { recursive: true });
  }

  // Create a new task with optional blocked_by dependencies
  create(subject: string, description = "", blockedBy: (string | number)[] = []): Task {
    const id = this._nextId();
    const ts = now();

    // Validate blocked_by references against disk
    const deps: Task[] = [];
    for (const depId of blockedBy) {
      const dep = this._load(String(depId));
      if (!dep) {
        throw new Error(`blocked_by task ${String(depId)} does not exist`);
      }
      deps.push(dep);
    }

    const task: Task = {
      id,
      subject,
      description,
      status: "pending",
      blockedBy: blockedBy.map(String),
      blocks: [],
      createdAt: ts,
      updatedAt: ts,
    };

    // Update reverse links: each dependency now blocks this task
    for (const dep of deps) {
      if (!dep.blocks.includes(id)) {
        dep.blocks.push(id);
        this._save(dep);
      }
    }

    this._save(task);
    return task;
  }

  // Update task status, subject, description, or dependency lists
  update(
    id: string | number,
    updates: {
      subject?: string;
      description?: string;
      status?: string;
      addBlockedBy?: (string | number)[];
      removeBlockedBy?: (string | number)[];
    },
  ): Task {
    const taskId = String(id);
    const task = this._load(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);

    if (updates.subject !== undefined) task.subject = updates.subject;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.status !== undefined) {
      const s = updates.status;
      if (s === "pending" || s === "in_progress" || s === "completed") {
        task.status = s;
      } else {
        throw new Error(`invalid status: ${s}`);
      }
    }

    // Add blocked_by dependencies
    if (updates.addBlockedBy) {
      for (const depId of updates.addBlockedBy) {
        const depStr = String(depId);
        // A task blocking itself would create an unresolvable dependency
        if (depStr === taskId) {
          throw new Error("task cannot block itself");
        }
        if (!task.blockedBy.includes(depStr)) {
          task.blockedBy.push(depStr);
          const dep = this._load(depStr);
          if (dep && !dep.blocks.includes(taskId)) {
            dep.blocks.push(taskId);
            this._save(dep);
          }
        }
      }
    }

    // Remove blocked_by dependencies
    if (updates.removeBlockedBy) {
      const removeSet = new Set(updates.removeBlockedBy.map(String));
      task.blockedBy = task.blockedBy.filter((b) => !removeSet.has(b));
      for (const depId of updates.removeBlockedBy) {
        const dep = this._load(String(depId));
        if (dep) {
          dep.blocks = dep.blocks.filter((b) => b !== taskId);
          this._save(dep);
        }
      }
    }

    // When completing, auto-clear this task from other tasks' blocked_by
    if (updates.status === "completed") {
      for (const other of this.list()) {
        if (other.id === taskId) continue;
        if (other.blockedBy.includes(taskId)) {
          other.blockedBy = other.blockedBy.filter((b) => b !== taskId);
          this._save(other);
        }
      }
      task.blocks = [];
    }

    task.updatedAt = now();
    this._save(task);
    return task;
  }

  // Get a task by ID
  get(id: string | number): Task {
    const taskId = String(id);
    const task = this._load(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    return task;
  }

  // List all tasks (scans the task directory)
  list(): Task[] {
    if (!existsSync(this._dir)) return [];
    const tasks: Task[] = [];
    for (const file of readdirSync(this._dir)) {
      if (!file.startsWith("task_") || !file.endsWith(".json")) continue;
      const id = file.slice("task_".length, -".json".length);
      const task = this._load(id);
      if (task) tasks.push(task);
    }
    tasks.sort((a, b) => Number(a.id) - Number(b.id));
    return tasks;
  }

  // Format all tasks as a human-readable summary string
  formatList(): string {
    const tasks = this.list();
    if (tasks.length === 0) return "No tasks.";

    const lines: string[] = [];
    for (const t of tasks) {
      const parts = [`#${t.id} [${t.status}] ${t.subject}`];
      if (t.blockedBy.length > 0) {
        parts.push(`(blocked by: ${t.blockedBy.join(", ")})`);
      }
      lines.push(parts.join(" "));
    }
    return lines.join("\n");
  }

  // Scan the task directory and return the next available integer ID as string
  private _nextId(): string {
    let maxId = 0;
    if (existsSync(this._dir)) {
      for (const file of readdirSync(this._dir)) {
        if (!file.startsWith("task_") || !file.endsWith(".json")) continue;
        const numId = Number(file.slice("task_".length, -".json".length));
        if (Number.isInteger(numId) && numId > maxId) maxId = numId;
      }
    }
    return String(maxId + 1);
  }

  private _filePath(id: string): string {
    return path.join(this._dir, `task_${id}.json`);
  }

  private _save(task: Task): void {
    writeFileSync(this._filePath(task.id), JSON.stringify(task, null, 2) + "\n", "utf-8");
  }

  // Read a single task file from disk; returns null if missing or unparseable.
  // Falls back to legacy snake_case fields (blocked_by/created_at/updated_at, numeric id).
  private _load(id: string): Task | null {
    const filePath = this._filePath(id);
    if (!existsSync(filePath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
      if (!isRecord(parsed)) return null;
      const data = parsed;

      const idRaw = data["id"];
      const taskId =
        typeof idRaw === "string" && idRaw !== ""
          ? idRaw
          : typeof idRaw === "number"
            ? String(idRaw)
            : id;

      const subject = typeof data["subject"] === "string" ? data["subject"] : "";
      const description = typeof data["description"] === "string" ? data["description"] : "";
      const statusRaw = data["status"];
      const status =
        statusRaw === "pending" || statusRaw === "in_progress" || statusRaw === "completed"
          ? statusRaw
          : "pending";

      const createdAtRaw = data["createdAt"] ?? data["created_at"];
      const updatedAtRaw = data["updatedAt"] ?? data["updated_at"];
      const createdAt = typeof createdAtRaw === "string" ? createdAtRaw : "";
      const updatedAt = typeof updatedAtRaw === "string" ? updatedAtRaw : "";

      const blockedByRaw = data["blockedBy"] ?? data["blocked_by"];
      const blocksRaw = data["blocks"];

      return {
        id: taskId,
        subject,
        description,
        status,
        blockedBy: Array.isArray(blockedByRaw) ? blockedByRaw.map(String) : [],
        blocks: Array.isArray(blocksRaw) ? blocksRaw.map(String) : [],
        createdAt,
        updatedAt,
      };
    } catch {
      return null;
    }
  }
}
