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

import { spawnSync } from "node:child_process";
import { BASH_DESCRIPTION } from "./descriptions.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";
import { intArg, strArg } from "../utils/index.js";
import type { Sandbox, SandboxConfig } from "@/sandbox/index.js";

const MAX_TIMEOUT = 600;

/**
 * Extract the base command name from a command string.
 * For piped commands, take the last segment (bash returns the exit code of the last command in a pipeline by default).
 */
function extractBaseCmd(command: string): string {
  // Split by pipe, take the last segment command
  const lastSegment = command.split("|").pop()?.trim() ?? command;
  // Extract base command name: skip env variable assignments and path prefixes
  const tokens = lastSegment.split(/\s+/);
  for (const token of tokens) {
    // Skip tokens like VAR=value (environment variable assignments)
    if (token.includes("=") && !token.startsWith("-")) {
      continue;
    }
    // Strip path prefix, keep only the command name
    return token.split("/").pop() ?? token;
  }
  return "";
}

// Exit code semantics for special commands, helping the LLM understand non-zero exit codes
const exitCodeHints = new Map<string, Map<number, string>>([
  ["grep", new Map([[1, "no matches found"]])],
  ["egrep", new Map([[1, "no matches found"]])],
  ["fgrep", new Map([[1, "no matches found"]])],
  ["rg", new Map([[1, "no matches found"]])],
  ["diff", new Map([[1, "files differ"]])],
  ["test", new Map([[1, "condition is false"]])],
  ["[", new Map([[1, "condition is false"]])],
  ["find", new Map([[1, "partial success"]])],
]);

/**
 * Return a semantic hint for non-zero exit codes of special commands, helping the LLM understand the exit code meaning.
 * Returns empty string if the command or exit code is not recognized.
 */
function exitCodeHint(command: string, exitCode: number): string {
  const baseCmd = extractBaseCmd(command);
  const hints = exitCodeHints.get(baseCmd);
  return hints?.get(exitCode) ?? "";
}

// const BashErrorSchema = z.object({
//   status: z.coerce.number().optional(),
//   stdout: z.string().optional(),
//   stderr: z.string().optional(),
//   killed: z.boolean().optional(),
//   message: z.string().optional(),
// });

export class BashTool implements Tool {
  // Use a hardcoded string instead of BashTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "Bash";

  description: string = BASH_DESCRIPTION;
  category: ToolCategory = "command";

  // OS-level sandbox instance and config, injected externally
  sandbox: Sandbox | null = null;
  sandboxConfig: SandboxConfig = {
    allowWrite: [],
    denyWrite: [],
    networkEnabled: true,
  };

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        command: {
          type: "string" as const,
          description: "Shell command to execute",
        },
        timeout: {
          type: "integer" as const,
          description: "Timeout in seconds (max 600)",
          default: 120,
        },
      },
      required: ["command"],
    };

    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    // TODO: Migrate manual parse to zod.
    const command = strArg(args, "command");
    if (!command) {
      return Promise.resolve({
        output: "Error: command is required",
        isError: true,
      });
    }

    let timeout = intArg(args, "timeout", 120);
    if (timeout > MAX_TIMEOUT) {
      timeout = MAX_TIMEOUT;
    }

    // Sandbox wrapping: if a sandbox is available, wrap the command in the sandbox environment
    let actualCommand = command;
    if (this.sandbox?.available()) {
      actualCommand = this.sandbox.wrap(command, this.sandboxConfig);
    }

    // stdout and stderr captured separately, merged into unified output later
    const result = spawnSync("bash", ["-c", actualCommand], {
      cwd: ctx.workDir,
      timeout: timeout * 1000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error && result.signal === "SIGTERM") {
      return Promise.resolve({
        output: `Error: command timed out after ${String(timeout)}s`,
        isError: true,
      });
    }

    if (result.error && !result.stdout && !result.stderr) {
      return Promise.resolve({
        output: `Error executing command: ${result.error.message}`,
        isError: true,
      });
    }

    const exitCode = result.status ?? 0;
    let output = `$ ${command}\n`;
    // Merge stdout and stderr, no prefix added
    if (result.stdout) {
      output += result.stdout;
    }
    if (result.stderr) {
      output += result.stderr;
    }

    if (exitCode !== 0) {
      const hint = exitCodeHint(command, exitCode);
      output += hint
        ? `\nExit code ${String(exitCode)} (${hint})`
        : `\nExit code ${String(exitCode)}`;
    }

    return Promise.resolve({ output, isError: false });
  }
}
