import { execFile } from "node:child_process";

import { intArg, strArg } from "../utils/index.js";

import { POWERSHELL_DESCRIPTION } from "./descriptions.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";

const MAX_TIMEOUT = 600;

/**
 * Extract the base command name from a command string.
 * For piped commands, take the last segment (PowerShell surfaces the exit code of the last native command in a pipeline).
 */
function extractBaseCmd(command: string): string {
  // Split by pipe, take the last segment command
  const lastSegment = command.split("|").pop()?.trim() ?? command;
  // Extract base command name: skip variable assignments and path prefixes
  const tokens = lastSegment.split(/\s+/);
  for (const token of tokens) {
    // Skip tokens like $env:VAR="value" or VAR=value (variable assignments)
    if (token.includes("=") && !token.startsWith("-")) {
      continue;
    }
    // Strip path prefix (both separators on Windows) and the .exe suffix;
    // Windows command names are case-insensitive, so normalize to lowercase
    const base = token.split(/[\\/]/).pop() ?? token;
    return base.replace(/\.exe$/i, "").toLowerCase();
  }
  return "";
}

// Exit code semantics for special commands, helping the LLM understand non-zero exit codes
const exitCodeHints = new Map<string, Map<number, string>>([
  ["findstr", new Map([[1, "no matches found"]])],
  ["where", new Map([[1, "not found"]])],
  ["grep", new Map([[1, "no matches found"]])],
  ["rg", new Map([[1, "no matches found"]])],
  ["diff", new Map([[1, "files differ"]])],
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

export class PowerShellTool implements Tool {
  // Use a hardcoded string instead of PowerShellTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "PowerShell";

  description: string = POWERSHELL_DESCRIPTION;
  category: ToolCategory = "command";

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        command: {
          type: "string" as const,
          description: "PowerShell command to execute",
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

    // No OS-sandbox wrapping here: the seatbelt/bwrap wrappers are bash-specific
    // (`... bash -c '...'`), and Windows — this tool's primary platform — has no
    // OS sandbox support anyway.
    const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";

    // Async execution keeps the Node event loop free (see BashTool for details).
    // Semantics preserved: SIGTERM on timeout, 10MB maxBuffer (child killed,
    // truncated output still returned), merged stdout+stderr.
    // ctx.abortSignal additionally lets Esc kill the child.
    return new Promise<ToolResult>((resolve) => {
      execFile(
        shell,
        ["-NoProfile", "-NonInteractive", "-Command", command],
        {
          cwd: ctx.workDir,
          timeout: timeout * 1000,
          killSignal: "SIGTERM",
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          ...(ctx.abortSignal ? { signal: ctx.abortSignal } : {}),
        },
        (error, stdout, stderr) => {
          if (error?.name === "AbortError") {
            resolve({ output: "Error: command interrupted", isError: true });
            return;
          }

          // Node kills the child with killSignal when the timeout elapses.
          if (error && error.killed && error.signal === "SIGTERM") {
            resolve({
              output: `Error: command timed out after ${String(timeout)}s`,
              isError: true,
            });
            return;
          }

          // Spawn-level failure (e.g. ENOENT): string code, no output produced.
          if (error && typeof error.code !== "number" && !stdout && !stderr) {
            const hint =
              error.code === "ENOENT" && process.platform !== "win32"
                ? " (pwsh is required on macOS/Linux — install PowerShell Core)"
                : "";
            resolve({
              output: `Error executing command: ${error.message}${hint}`,
              isError: true,
            });
            return;
          }

          // Non-zero exits surface as an error whose numeric code is the exit code.
          const exitCode = error && typeof error.code === "number" ? error.code : 0;
          let output = `PS> ${command}\n`;
          // Merge stdout and stderr, no prefix added
          if (stdout) {
            output += stdout;
          }
          if (stderr) {
            output += stderr;
          }

          if (exitCode !== 0) {
            const hint = exitCodeHint(command, exitCode);
            output += hint
              ? `\nExit code ${String(exitCode)} (${hint})`
              : `\nExit code ${String(exitCode)}`;
          }

          resolve({ output, isError: false });
        },
      );
    });
  }
}
