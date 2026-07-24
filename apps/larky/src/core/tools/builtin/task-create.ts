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

// TaskCreateTool: create a new tracked task
import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";
import type { TaskManager } from "../../task/manager.js";

// Task IDs are integers (stored internally as integer strings); accept both forms
export const TaskIdSchema = z.union([z.number().int(), z.string().regex(/^\d+$/)]);

export const TaskCreateParamsSchema = z.object({
  subject: z.string().describe("Short title for the task."),
  description: z
    .string()
    .optional()
    .describe("Optional longer description of what needs to be done."),
  blocked_by: z
    .array(TaskIdSchema)
    .optional()
    .describe("IDs of tasks that must be completed before this one."),
});

// Normalize a task ID value to an integer string; returns null for non-integer input
export function normalizeTaskId(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isInteger(n)) return null;
  return String(Math.trunc(n));
}

export class TaskCreateTool implements BaseTool {
  readonly name = "task_create";
  readonly description =
    "Create a new task to track a unit of work. " +
    "Use this to break down a complex goal into smaller, trackable steps. " +
    "Returns the created task as JSON.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      subject: { type: "string", description: "Short title for the task." },
      description: {
        type: "string",
        description: "Optional longer description of what needs to be done.",
      },
      blocked_by: {
        type: "array",
        items: { type: ["integer", "string"] },
        description: "IDs of tasks that must be completed before this one.",
      },
    },
    required: ["subject"],
  };
  readonly paramsModel = TaskCreateParamsSchema;

  private _manager: TaskManager;

  constructor(manager: TaskManager) {
    this._manager = manager;
  }

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      const subject = String(params["subject"]);
      const descRaw = params["description"];
      const description = typeof descRaw === "string" ? descRaw : "";
      const blockedByRaw = params["blocked_by"];
      const blockedBy: string[] = [];
      if (Array.isArray(blockedByRaw)) {
        for (const x of blockedByRaw) {
          const id = normalizeTaskId(x);
          if (id === null) {
            return Promise.resolve(
              toolError(`invalid task id in blocked_by: ${String(x)}`, "schema_error"),
            );
          }
          blockedBy.push(id);
        }
      }

      const task = this._manager.create(subject, description, blockedBy);
      return Promise.resolve(toolSuccess(JSON.stringify(task)));
    } catch (e) {
      return Promise.resolve(toolError(String(e), "runtime_error"));
    }
  }
}
