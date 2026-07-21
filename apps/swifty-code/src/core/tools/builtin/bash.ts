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

// BashTool: execute shell commands with timeout and output truncation
import { spawn } from "node:child_process";

import { z } from "zod";

import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT = 60;

export const BashParamsSchema = z.object({
  command: z.string().describe("Shell command to execute."),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(120)
    .default(DEFAULT_TIMEOUT)
    .describe("Maximum seconds to wait (default 60, max 120)."),
});

export class BashTool implements BaseTool {
  readonly name = "bash";
  readonly description =
    "Execute a shell command and return its output (stdout + stderr combined). " +
    "Non-interactive only -- commands requiring user input will hang and time out. " +
    "Prefer short, focused commands. Output is truncated at 64 KB.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "Shell command to execute." },
      timeout: {
        type: "integer",
        description: "Maximum seconds to wait (default 60, max 120).",
      },
    },
    required: ["command"],
  };
  readonly paramsModel = BashParamsSchema;

  async invoke(params: Record<string, unknown>): Promise<ToolResult> {
    const parsed = BashParamsSchema.parse(params);
    const { command, timeout } = parsed;

    return new Promise<ToolResult>((resolve) => {
      const proc = spawn("sh", ["-c", command], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const chunks: Buffer[] = [];
      let collectedBytes = 0;
      let truncated = false;
      let killed = false;
      let settled = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGKILL");
      }, timeout * 1000);

      const settle = (result: ToolResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const collectOutput = (chunk: Buffer): void => {
        // Stop accumulating once the cap is reached to avoid unbounded memory growth
        if (truncated) return;
        chunks.push(chunk);
        collectedBytes += chunk.length;
        if (collectedBytes > MAX_OUTPUT_BYTES) {
          truncated = true;
        }
      };

      // Concatenate collected output with the 64 KB cap (shared by the normal
      // and timeout paths)
      const buildOutput = (): string => {
        const buf = Buffer.concat(chunks);
        if (truncated || buf.length > MAX_OUTPUT_BYTES) {
          return buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf-8") + "\n[truncated]";
        }
        return buf.toString("utf-8");
      };

      // Return whatever output was collected before the kill, with a trailing
      // timeout marker, so partial output is not lost
      const settleTimeout = (): void => {
        const output = buildOutput();
        const marker = `[timeout after ${String(timeout)}s]`;
        settle(toolError(output === "" ? marker : `${output}\n${marker}`, "timeout"));
      };

      proc.stdout.on("data", collectOutput);
      proc.stderr.on("data", collectOutput);

      proc.on("error", (err: Error) => {
        settle(toolError(String(err), "runtime_error"));
      });

      // On timeout the shell is SIGKILLed, but orphaned grandchildren may keep
      // the stdio pipes open indefinitely, so "close" may never fire. Settle
      // from "exit" instead, after a short grace period that lets already
      // buffered "data" events flush.
      proc.on("exit", () => {
        if (!killed) return;
        setTimeout(settleTimeout, 50);
      });

      proc.on("close", (code) => {
        if (killed) {
          settleTimeout();
          return;
        }

        const output = buildOutput();

        if (code !== 0) {
          settle(toolError(`[exit ${String(code)}]\n${output}`, "runtime_error"));
          return;
        }

        if (output === "") {
          settle(toolSuccess("[no output]"));
          return;
        }

        settle(toolSuccess(output));
      });
    });
  }
}
