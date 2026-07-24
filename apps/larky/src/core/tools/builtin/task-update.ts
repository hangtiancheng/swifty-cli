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

// TaskUpdateTool: update task status or dependencies
import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";
import type { TaskManager } from "../../task/manager.js";
import { TaskIdSchema, normalizeTaskId } from "./task-create.js";

export const TaskUpdateParamsSchema = z.object({
  task_id: TaskIdSchema.describe("ID of the task to update."),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .optional()
    .describe("New status for the task."),
  add_blocked_by: z.array(TaskIdSchema).optional().describe("Task IDs to add to blocked_by."),
  remove_blocked_by: z
    .array(TaskIdSchema)
    .optional()
    .describe("Task IDs to remove from blocked_by."),
});

export class TaskUpdateTool implements BaseTool {
  readonly name = "task_update";
  readonly description =
    "Update a task's status or dependency list. " +
    "Set status to 'in_progress' when starting work on a task, " +
    "'completed' when finished (automatically clears it from other tasks' blocked_by). " +
    "Returns the updated task as JSON.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      task_id: {
        type: ["integer", "string"],
        description: "ID of the task to update.",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed"],
        description: "New status for the task.",
      },
      add_blocked_by: {
        type: "array",
        items: { type: ["integer", "string"] },
        description: "Task IDs to add to blocked_by.",
      },
      remove_blocked_by: {
        type: "array",
        items: { type: ["integer", "string"] },
        description: "Task IDs to remove from blocked_by.",
      },
    },
    required: ["task_id"],
  };
  readonly paramsModel = TaskUpdateParamsSchema;

  private _manager: TaskManager;

  constructor(manager: TaskManager) {
    this._manager = manager;
  }

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      const taskId = normalizeTaskId(params["task_id"]);
      if (taskId === null) {
        return Promise.resolve(
          toolError(`invalid task_id: ${String(params["task_id"])}`, "schema_error"),
        );
      }

      const statusRaw = params["status"];
      const status = typeof statusRaw === "string" ? statusRaw : undefined;

      const normalizeIdList = (raw: unknown, field: string): string[] | ToolResult | undefined => {
        if (!Array.isArray(raw)) return undefined;
        const ids: string[] = [];
        for (const x of raw) {
          const id = normalizeTaskId(x);
          if (id === null) {
            return toolError(`invalid task id in ${field}: ${String(x)}`, "schema_error");
          }
          ids.push(id);
        }
        return ids;
      };

      const addBlocked = normalizeIdList(params["add_blocked_by"], "add_blocked_by");
      if (addBlocked !== undefined && !Array.isArray(addBlocked)) {
        return Promise.resolve(addBlocked);
      }
      const removeBlocked = normalizeIdList(params["remove_blocked_by"], "remove_blocked_by");
      if (removeBlocked !== undefined && !Array.isArray(removeBlocked)) {
        return Promise.resolve(removeBlocked);
      }

      const task = this._manager.update(taskId, {
        ...(status !== undefined ? { status } : {}),
        ...(addBlocked !== undefined ? { addBlockedBy: addBlocked } : {}),
        ...(removeBlocked !== undefined ? { removeBlockedBy: removeBlocked } : {}),
      });
      return Promise.resolve(toolSuccess(JSON.stringify(task)));
    } catch (e) {
      return Promise.resolve(toolError(String(e), "runtime_error"));
    }
  }
}
