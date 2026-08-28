import { execFile, spawn } from "node:child_process";

import { asRecord, intArg, strArg } from "../utils/index.js";

import { POWERSHELL_DESCRIPTION } from "./descriptions.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";

const MAX_TIMEOUT = 600;
// Grace period between the graceful kill and the forced-kill escalation.
const KILL_GRACE_MS = 3000;

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

    if (ctx.abortSignal?.aborted) {
      return Promise.resolve({ output: "Error: command interrupted", isError: true });
    }

    // Async execution keeps the Node event loop free (see BashTool for details).
    //
    // Timeout and abort are handled manually instead of via execFile's
    // timeout/signal options: those only signal the direct child, so a
    // command that spawns children or ignores the signal keeps running and
    // the callback never fires, wedging the agent loop and making Esc appear
    // dead. On POSIX `detached` puts the child in its own process group so
    // the whole tree can be killed (SIGTERM, then SIGKILL escalation); on
    // Windows the tree is killed via `taskkill /T`, forced after the grace
    // period.
    return new Promise<ToolResult>((resolve) => {
      let timedOut = false;
      let aborted = false;
      let terminating = false;
      let escalateTimer: NodeJS.Timeout | null = null;

      const child = spawn(shell, ["-NoProfile", "-NonInteractive", "-Command", command], {
        cwd: ctx.workDir,
        // Only POSIX needs its own process group for kill(-pid); the Windows
        // tree kill goes through taskkill and needs no new group.
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Same 10MB cap as execFile's maxBuffer: on overflow the child is
      // killed and the truncated output is still returned.
      const maxBuffer = 10 * 1024 * 1024;
      let stdout = "";
      let stderr = "";
      let total = 0;

      const alreadyExited = () => child.exitCode !== null || child.signalCode !== null;

      // Kill the child's whole process tree; fall back to the direct child
      // when the group is already gone or the tree kill fails.
      const killTree = (signal: NodeJS.Signals) => {
        if (typeof child.pid !== "number") {
          return;
        }
        if (process.platform === "win32") {
          // taskkill /T terminates the whole tree; /F is the forced variant.
          const flags = ["/pid", String(child.pid), "/T"];
          if (signal === "SIGKILL") {
            flags.push("/F");
          }
          execFile("taskkill", flags, (err) => {
            if (err && !alreadyExited()) {
              try {
                child.kill(signal);
              } catch {
                /* already dead */
              }
            }
          });
          return;
        }
        try {
          process.kill(-child.pid, signal);
        } catch {
          try {
            child.kill(signal);
          } catch {
            /* already dead */
          }
        }
      };

      const terminate = () => {
        if (terminating) {
          return;
        }
        terminating = true;
        killTree("SIGTERM");
        escalateTimer = setTimeout(() => {
          killTree("SIGKILL");
          // A daemonized grandchild can inherit the pipes and hold `close`
          // hostage; dropping our ends lets the callback fire once the
          // direct child is gone.
          child.stdout.destroy();
          child.stderr.destroy();
        }, KILL_GRACE_MS);
        escalateTimer.unref();
      };

      const appendChunk = (chunk: string, target: "stdout" | "stderr") => {
        let piece = chunk;
        if (total + piece.length > maxBuffer) {
          piece = piece.slice(0, maxBuffer - total);
          terminate();
        }
        total += piece.length;
        if (target === "stdout") {
          stdout += piece;
        } else {
          stderr += piece;
        }
      };

      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (chunk: string) => {
        appendChunk(chunk, "stdout");
      });
      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (chunk: string) => {
        appendChunk(chunk, "stderr");
      });

      const onAbort = () => {
        if (alreadyExited()) {
          return;
        }
        aborted = true;
        terminate();
      };

      const timeoutTimer = setTimeout(() => {
        if (alreadyExited()) {
          return;
        }
        timedOut = true;
        terminate();
      }, timeout * 1000);
      timeoutTimer.unref();

      ctx.abortSignal?.addEventListener("abort", onAbort, { once: true });

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (escalateTimer) {
          clearTimeout(escalateTimer);
        }
        ctx.abortSignal?.removeEventListener("abort", onAbort);
      };

      // Spawn-level failure (e.g. pwsh not installed): no close event guaranteed.
      child.on("error", (err) => {
        cleanup();
        const hint =
          strArg(asRecord(err), "code") === "ENOENT" && process.platform !== "win32"
            ? " (pwsh is required on macOS/Linux — install PowerShell Core)"
            : "";
        resolve({
          output: `Error executing command: ${err.message}${hint}`,
          isError: true,
        });
      });

      child.on("close", (code) => {
        cleanup();

        if (aborted) {
          resolve({ output: "Error: command interrupted", isError: true });
          return;
        }

        if (timedOut) {
          resolve({
            output: `Error: command timed out after ${String(timeout)}s`,
            isError: true,
          });
          return;
        }

        const exitCode = code ?? 0;
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
      });
    });
  }
}
