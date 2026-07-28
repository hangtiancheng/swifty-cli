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

import type { FileHistory } from "@/file-history/file-history.js";
import type { ImageAttachment } from "@/images/types.js";
import type { FileStateCache } from "./file-state-cache.js";

export type ToolCategory = "read" | "write" | "command";

export interface ToolResult {
  output: string;
  isError: boolean;
  /** Images returned by the tool (e.g. ReadFile on a png). `output` holds a
   * short placeholder label so text-only consumers still see something. */
  images?: ImageAttachment[] | undefined;
}

export interface ToolContext {
  workDir: string;
  abortSignal?: AbortSignal;
  fileHistory?: FileHistory | undefined;
  fileStateCache?: FileStateCache | undefined;
}

export interface ToolSchema {
  name: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
  /** For OpenAI, this must be "function"; for Anthropic, it can be "custom" or null */
  type?: "function" | "custom";
  defer_loading?: boolean;
  description: string;

  /** The input schema for the tool. */
  input_schema: {
    type: "object";
    properties: Record<string, object>;
    required?: string[];
  };
  allowed_callers?: ("direct" | "code_execution_20250825" | "code_execution_20260120")[];
  cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
  eager_input_streaming?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  category: ToolCategory;

  /**
   * Whether to defer loading. A deferred tool does not appear in the initial
   * tool list; the model must first pull its schema out via ToolSearch before
   * it can call it.
   *
   * Only MCP tools are set to true. MCP is configured per project, a single
   * server can easily expose dozens of tools with long schemas, and stuffing
   * all of them into the initial tool list would eat up a large chunk of the
   * context — especially since most of those tools won't be used in a given
   * session. Built-in tools are a fixed few dozen, a controllable count;
   * hiding them would only force the model into an extra ToolSearch round
   * trip, so they are never deferred and always ship their full schema.
   */
  deferred?: boolean;

  schema(): ToolSchema;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

export const SKIP_DIRS = new Set([
  ".claude", // Claude Code
  ".git", // Git
  ".larky", // Larky
  ".next", // Next.js
  ".venv", // Python venv
  ".mypy_cache", // Python mypy
  ".tox", // Python tox
  "__pycache__", // Python
  "build", // C++
  "dist", // Webpack, Vite
  "node_modules", // Node.js
  "vendor", // Go
  "venv", // Python venv
]);
