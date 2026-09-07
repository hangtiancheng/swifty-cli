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

import type { Command, CommandRegistry } from "../../commands/commands.js";
import { MCP_TOOL_PREFIX } from "../../mcp/tool-wrapper.js";
import type { SkillCatalog } from "../../skills/catalog.js";
import { runInline as runSkillInline } from "../../skills/executor.js";
import type { SkillHost } from "../../skills/skill.js";
import type { TaskList } from "../../todo/todo.js";
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from "../../todo/tools.js";
import { BashTool } from "../../tools/bash.js";
import { EditFileTool } from "../../tools/edit-file.js";
import { EnterWorktreeTool } from "../../tools/enter-worktree.js";
import { ExitPlanModeTool } from "../../tools/exit-plan-mode.js";
import { ExitWorktreeTool } from "../../tools/exit-worktree.js";
import { McpCallTool } from "../../tools/mcp-call.js";
import { PowerShellTool } from "../../tools/powershell.js";
import { ReadFileTool } from "../../tools/read-file.js";
import { ToolRegistry } from "../../tools/registry.js";
import { ToolSearchTool } from "../../tools/tool-search.js";
import { GlobTool } from "../../tools/wasm/glob.js";
import { GrepTool } from "../../tools/wasm/grep.js";
import { WriteFileTool } from "../../tools/write-file.js";

import { strArg } from "@/utils/index.js";

export function countMcpTools(registry: ToolRegistry): number {
  return registry.listTools().filter((t) => t.name.startsWith(MCP_TOOL_PREFIX)).length;
}

export function createToolRegistry(workDir: string, taskList: TaskList): ToolRegistry {
  const registry = new ToolRegistry();
  // new InstallSkillTool
  // new LoadSkillTool
  // new AgentTool
  // new TaskStopTool
  registry.register(new TaskCreateTool(taskList)); // todo.TaskCreateTool
  registry.register(new TaskGetTool(taskList)); // todo.TaskGetTool
  registry.register(new TaskListTool(taskList)); // todo.TaskListTool

  registry.register(new TaskUpdateTool(taskList)); // todo.TaskUpdateTool
  // new TeamCreateTool
  // new SpawnTeammateTool
  // new SendMessageTool
  // new ListTeamsTool
  // new TeamDeleteTool
  // new SyntheticOutputTool

  // new AskUserQuestionTool
  registry.register(new BashTool());
  registry.register(new PowerShellTool());
  registry.register(new EditFileTool());
  registry.register(new EnterWorktreeTool());
  registry.register(new ExitPlanModeTool());
  registry.register(new ExitWorktreeTool());
  registry.register(new ReadFileTool());
  registry.register(new ToolSearchTool(registry));

  // McpCall must be registered before connecting to MCP. Registering it after
  // connecting based on the load mode is itself a mid-flight mutation of
  // tools[], which breaks the cache prefix just the same.
  registry.register(new McpCallTool(registry));

  registry.register(new WriteFileTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  return registry;
}

/**
 * wireSkillsToRegistry registers every loaded skill as a slash command in the
 * CommandRegistry. Inline skills become
 * "prompt" commands whose handler renders the skill body; fork-mode skills
 * become "skill_fork" commands (dispatched separately in executeCommand).
 *
 * Idempotent: silently skips a name that's already taken (e.g. a built-in or
 * user command registered earlier).
 */
export function wireSkillsToRegistry(
  catalog: SkillCatalog,
  cmdRegistry: CommandRegistry,
  skillHost: SkillHost,
): void {
  for (const meta of catalog.list()) {
    // Don't shadow existing built-in or user commands.
    if (cmdRegistry.find(meta.name)) {
      continue;
    }

    const skill = catalog.get(meta.name);
    if (!skill) {
      continue;
    }

    const isFork = skill.meta.mode === "fork";

    const cmd: Command = {
      name: meta.name,
      aliases: [],
      type: isFork ? "skill_fork" : "prompt",
      description: `${meta.description} [skill]`,
      handler: isFork
        ? () => "" // fork dispatch handled in executeCommand before handler
        : (ctx) => runSkillInline(skill, ctx.args, skillHost),
    };
    try {
      cmdRegistry.register(cmd);
    } catch {
      // name clash → keep the existing command
    }
  }
}

// Compose the coordinator filter (active when teams exist) with an optional
// skill-based filter. Both must agree for a tool to be included. When no
// skill filter is set, only the coordinator filter is consulted.
export function buildComposedToolFilter(
  coordinator: (name: string) => boolean,
  skillFilter: ((name: string) => boolean) | null,
): (name: string) => boolean {
  if (!skillFilter) {
    return coordinator;
  }
  return (name: string) => coordinator(name) && skillFilter(name);
}

export function formatToolArgs(args: Record<string, unknown>): string {
  if (args.command) {
    return truncate(strArg(args, "command"), 80);
  }
  if (args.file_path) {
    return truncate(strArg(args, "file_path"), 80);
  }
  if (args.pattern) {
    return truncate(strArg(args, "pattern"), 80);
  }
  return "";
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\u2026" : s;
}
