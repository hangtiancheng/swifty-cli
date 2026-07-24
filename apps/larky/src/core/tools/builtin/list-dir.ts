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

// ListDirTool: recursive directory listing with tree formatting and limits
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";

const MAX_DEPTH = 4;
const MAX_ENTRIES = 200;

export const ListDirParamsSchema = z.object({
  path: z.string().default(".").describe("Relative path to the directory (default '.')."),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(MAX_DEPTH)
    .default(2)
    .describe(`How many levels deep to recurse (default 2, max ${String(MAX_DEPTH)}).`),
});

interface DirEntry {
  name: string;
  isDir: boolean;
}

export class ListDirTool implements BaseTool {
  readonly name = "list_dir";
  readonly description =
    "List the contents of a directory as a tree. " +
    "Path must be relative to the current working directory. " +
    "Hidden entries (starting with .) are included. " +
    `Maximum depth is ${String(MAX_DEPTH)}, maximum total entries is ${String(MAX_ENTRIES)}.`;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Relative path to the directory (default '.').",
      },
      max_depth: {
        type: "integer",
        description: `How many levels deep to recurse (default 2, max ${String(MAX_DEPTH)}).`,
      },
    },
    required: [],
  };
  readonly paramsModel = ListDirParamsSchema;

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = ListDirParamsSchema.parse(params);
    const rootPath = parsed.path;
    const maxDepth = parsed.max_depth;

    // Path traversal check: reject raw ".." components on both POSIX and Windows
    if (rootPath.split(/[/\\]/).includes("..")) {
      return Promise.resolve(toolError(`path traversal not allowed: ${rootPath}`, "runtime_error"));
    }

    const root = path.resolve(rootPath);
    let rootStat;
    try {
      rootStat = statSync(root);
    } catch {
      return Promise.resolve(toolError(`no such directory: ${rootPath}`, "runtime_error"));
    }
    if (!rootStat.isDirectory()) {
      return Promise.resolve(toolError(`not a directory: ${rootPath}`, "runtime_error"));
    }

    const lines: string[] = [root + "/"];
    let count = 0;

    const walk = (dir: string, depth: number, prefix: string): void => {
      if (depth > maxDepth || count >= MAX_ENTRIES) return;

      let entries: DirEntry[];
      try {
        entries = readdirSync(dir, { withFileTypes: true })
          .map((dirent) => ({ name: dirent.name, isDir: dirent.isDirectory() }))
          .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
      } catch {
        // Don't silently drop the subtree: mark this directory as unreadable.
        // The directory's own line is the last one pushed before recursion.
        lines[lines.length - 1] += " (unreadable)";
        return;
      }

      for (const [i, entry] of entries.entries()) {
        if (count >= MAX_ENTRIES) {
          lines.push(`${prefix}... (truncated)`);
          return;
        }

        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const suffix = entry.isDir ? "/" : "";
        lines.push(`${prefix}${connector}${entry.name}${suffix}`);
        count++;

        if (entry.isDir && depth < maxDepth) {
          const childPrefix = isLast ? `${prefix}    ` : `${prefix}│   `;
          walk(path.join(dir, entry.name), depth + 1, childPrefix);
        }
      }
    };

    walk(root, 1, "");
    return Promise.resolve(toolSuccess(lines.join("\n")));
  }
}
