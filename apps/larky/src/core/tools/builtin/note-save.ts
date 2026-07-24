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

// NoteSaveTool: persist session notes via SessionStore
import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";
import type { SessionStore } from "../../session/store.js";

export const NoteSaveParamsSchema = z.object({
  content: z.string().describe("The durable fact or decision to remember."),
});

export class NoteSaveTool implements BaseTool {
  readonly name = "note_save";
  readonly description =
    "Save a concise fact or decision to this session's notes. " +
    "These notes are visible in future turns of the same session.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      content: {
        type: "string",
        description: "The durable fact or decision to remember.",
      },
    },
    required: ["content"],
  };
  readonly paramsModel = NoteSaveParamsSchema;

  private _store: SessionStore;
  private _sessionId: string;
  private _runId: string;

  constructor(store: SessionStore, sessionId: string, runId: string) {
    this._store = store;
    this._sessionId = sessionId;
    this._runId = runId;
  }

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = NoteSaveParamsSchema.parse(params);
    const content = parsed.content.trim();

    if (!content) {
      return Promise.resolve(toolError("empty content", "runtime_error"));
    }

    this._store.appendNote(this._sessionId, content, this._runId);
    return Promise.resolve(toolSuccess("saved"));
  }
}
