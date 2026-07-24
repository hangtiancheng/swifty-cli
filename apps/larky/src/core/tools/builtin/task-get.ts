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

// TaskGetTool: retrieve full task details by ID
import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";
import type { TaskManager } from "../../task/manager.js";
import { TaskIdSchema, normalizeTaskId } from "./task-create.js";

export const TaskGetParamsSchema = z.object({
  task_id: TaskIdSchema.describe("ID of the task to retrieve."),
});

export class TaskGetTool implements BaseTool {
  readonly name = "task_get";
  readonly description = "Get full details of a task by its integer ID. Returns the task as JSON.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      task_id: {
        type: ["integer", "string"],
        description: "ID of the task to retrieve.",
      },
    },
    required: ["task_id"],
  };
  readonly paramsModel = TaskGetParamsSchema;

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
      const task = this._manager.get(taskId);
      return Promise.resolve(toolSuccess(JSON.stringify(task)));
    } catch (e) {
      return Promise.resolve(toolError(String(e), "runtime_error"));
    }
  }
}
