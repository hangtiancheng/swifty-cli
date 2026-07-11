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
 * 从命令字符串中提取基础命令名。
 * 管道命令取最后一段（bash 默认返回管道最后一个命令的退出码）。
 */
function extractBaseCmd(command: string): string {
  // 按管道符拆分，取最后一段命令
  const lastSegment = command.split("|").pop()?.trim() ?? command;
  // 提取基础命令名：跳过 env 变量赋值和路径前缀
  const tokens = lastSegment.split(/\s+/);
  for (const token of tokens) {
    // 跳过形如 VAR=value 的环境变量设置
    if (token.includes("=") && !token.startsWith("-")) {
      continue;
    }
    // 去掉路径前缀，只保留命令名
    return token.split("/").pop() ?? token;
  }
  return "";
}

// 特殊命令的退出码语义提示，帮助 LLM 理解非零退出码的含义
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
 * 为特殊命令的非零退出码返回语义提示，帮助 LLM 理解退出码含义。
 * 如果不是已知的特殊命令或退出码，返回空字符串。
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

  // OS 级沙箱实例及配置，由外部注入
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

    // 沙箱包装：如果沙箱可用，将命令包装在沙箱环境中执行
    let actualCommand = command;
    if (this.sandbox?.available()) {
      actualCommand = this.sandbox.wrap(command, this.sandboxConfig);
    }

    // stdout 和 stderr 分别捕获，后续合并为统一输出
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
    // 合并 stdout 和 stderr，不加前缀
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
