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

import { createChildLogger } from "../logger/index.js";
import type { Tool, ToolResult, ToolContext, ToolSchema } from "../tools/types.js";
import type { AgentDefinition } from "./definition.js";
import { loadAgentDefinitions } from "./loader.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ConversationManager } from "../conversation/conversation.js";
import type { TeamManager, RunAgent } from "../teams/team.js";
import { asErrorString, boolArg, strArg } from "@/utils/index.js";
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from "../teams/task-tools.js";
import { SendMessageTool } from "../teams/tools.js";
import { ALL_AGENT_DISALLOWED_TOOLS, TEAMMATE_DISALLOWED_TOOLS } from "./tool-filter.js";
import { PermissionChecker } from "../permissions/checker.js";
import { buildWorktreeNotice, createAgentWorktree } from "../worktree/worktree.js";
import { randomBytes } from "node:crypto";

const log = createChildLogger({ module: "subagent" });
/** Fallback target when subagent_type is omitted and fork is disabled */
const GENERAL_PURPOSE_AGENT_TYPE = "general-purpose";

/** Worktree directory name. Uses a random string instead of the task description — spaces and non-ASCII characters in descriptions cannot be used directly as branch names. */
function newAgentSlug(): string {
  return `agent-a${randomBytes(4).toString("hex").slice(0, 7)}`;
}

// Leading marker for forked child Agents — used for nested fork detection
const FORK_BOILERPLATE_TAG = "<fork_boilerplate>";
const FORK_QUERY_SOURCE = "agent:builtin:fork";

// System instructions injected into forked child Agents
const FORK_BOILERPLATE = `${FORK_BOILERPLATE_TAG}
You are a forked worker process. You are NOT the main agent.
Rules (non-negotiable):
1. Do NOT fork again.
2. Do NOT converse, ask questions, or request confirmation.
3. Use tools directly: read files, search code, make changes.
4. Stay strictly within your assigned task scope.
5. Final report must be under 500 characters, starting with "Scope:".
</fork_boilerplate>`;

export class AgentTool implements Tool {
  name = "Agent";
  description = "Launch a subagent to handle complex, multi-step tasks.";
  category = "read" as const;

  private definitions: AgentDefinition[];
  private registry: ToolRegistry;
  private conversation?: ConversationManager;

  // Identifies the derived context of the current AgentTool instance;
  // re-forking is prohibited when non-empty and equal to FORK_QUERY_SOURCE
  querySource = "";

  /** Optional: Team manager, enables the team_name parameter. */
  private teamManager?: TeamManager;
  private workDir: string;
  /**
   * When fork is disabled, omitting subagent_type no longer forks but falls back to the
   * general-purpose agent. The "disabled" semantics (rather than "enabled") are used so
   * that the default value represents the default behavior (fork available), and each
   * construction site does not need to explicitly assign it.
   */
  forkDisabled = false;
  /**
   * Optional: factory that produces a per-teammate RunAgent. Receives a
   * teammate-scoped tool registry (with shared task-board tools injected)
   * and returns the callback that runs the teammate agent's main loop.
   */
  private teamRunAgentFactory?: (registry: ToolRegistry, checker?: PermissionChecker) => RunAgent;

  private spawnHandler: (
    definition: AgentDefinition,
    prompt: string,
    background: boolean,
    modelOverride?: string,
    workDirOverride?: string,
  ) => Promise<string>;

  private forkHandler?: (
    prompt: string,
    conversation: ConversationManager,
    registry: ToolRegistry,
    modelOverride?: string,
  ) => Promise<string>;

  constructor(
    workDir: string,
    registry: ToolRegistry,
    spawnHandler: (
      def: AgentDefinition,
      prompt: string,
      bg: boolean,
      modelOverride?: string,
      workDirOverride?: string,
    ) => Promise<string>,
    conversation?: ConversationManager,
    forkHandler?: (
      prompt: string,
      conversation: ConversationManager,
      registry: ToolRegistry,
      modelOverride?: string,
    ) => Promise<string>,
  ) {
    this.definitions = loadAgentDefinitions(workDir);
    this.workDir = workDir;
    this.registry = registry;
    this.spawnHandler = spawnHandler;
    this.conversation = conversation;
    this.forkHandler = forkHandler;
  }

  /**
   * Sets the team manager and teammate run callback, enabling the team_name parameter.
   * Once configured, the Agent tool can spawn teammates directly without requiring a separate SpawnTeammate tool.
   */
  setTeamManager(
    mgr: TeamManager,
    runAgentFactory: (registry: ToolRegistry, checker?: PermissionChecker) => RunAgent,
  ): void {
    this.teamManager = mgr;
    this.teamRunAgentFactory = runAgentFactory;
  }

  schema(): ToolSchema {
    const agentTypes = this.definitions.map((d) => d.name);
    return {
      name: this.name,
      description: this.buildDescription(),
      input_schema: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Short description of what the agent will do",
          },
          prompt: {
            type: "string",
            description: "The task for the agent to perform",
          },
          subagent_type: {
            type: "string",
            enum: agentTypes,
            description: "Agent type. Omit to fork current conversation context.",
          },
          model: {
            type: "string",
            description: "Override the model for this agent.",
          },
          run_in_background: {
            type: "boolean",
            description: "Run in background",
            default: false,
          },
          isolation: {
            type: "string",
            enum: ["worktree"],
            description:
              "Set to 'worktree' to run the agent in its own Git worktree, so its edits " +
              "cannot collide with the parent or with other agents working in parallel.",
          },
          plan_mode_required: {
            type: "boolean",
            description:
              "Only meaningful together with team_name. When true, the teammate starts in " +
              "plan mode: it can read and investigate but cannot modify anything until it " +
              "submits a plan and you approve it via SendMessage with " +
              "type='plan_approval_response'. Use it for risky or ambiguous tasks where a " +
              "wrong direction would cost a lot of rework.",
          },
          team_name: {
            type: "string",
            description:
              "REQUIRED when creating team members. Spawns the agent as a long-running " +
              "teammate under this team (created via TeamCreate). Unlike regular subagents, " +
              "team members persist after the lead returns and communicate via SendMessage. " +
              "Without team_name the agent runs as a one-shot subagent that blocks and returns inline.",
          },
        },
        required: ["description", "prompt"],
      },
    };
  }

  private buildDescription(): string {
    let desc = `Launch a subagent to handle a complex task. Each subagent runs independently with its own context. The subagent cannot see the current conversation.

This is ONE tool with multiple roles. Roles are NOT separate tools — you pick one by passing its name in the "subagent_type" parameter. Do not search for a tool named after a role; call THIS tool ("Agent") and set "subagent_type".

Available roles for the "subagent_type" parameter:`;

    for (const def of this.definitions) {
      desc += `\n- ${def.name}: ${def.description}`;
    }

    desc += `

Example call shape:
{
  "name": "Agent",
  "input": {
    "subagent_type": "<role from the list above>",
    "description": "Short task label",
    "prompt": "Detailed instructions — the subagent has zero prior context"
  }
}

Write a detailed prompt explaining what the subagent should do and why — it has no prior context.
When tasks are independent, launch multiple subagents in parallel by making multiple Agent tool calls in a single response.`;
    return desc;
  }

  async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const description = strArg(args, "description");
    const prompt = strArg(args, "prompt");
    if (!description || !prompt) {
      return {
        output: "Error: description and prompt are required",
        isError: true,
      };
    }

    // The routing when subagent_type is omitted is determined by configuration: if fork is
    // enabled, it inherits the parent conversation; if disabled, it is treated as unspecified
    // and falls back to the general-purpose agent. No error is thrown here — the model simply
    // did not provide an optional parameter, and aborting the call for that is not worthwhile;
    // the general-purpose agent can get the job done just as well.
    const subagentType =
      strArg(args, "subagent_type") || (this.forkDisabled ? GENERAL_PURPOSE_AGENT_TYPE : "");
    const modelOverride = strArg(args, "model");
    const background = boolArg(args, "run_in_background");
    const teamName = strArg(args, "team_name");
    const isolation = strArg(args, "isolation");

    // Team-member path: team_name takes precedence over fork/subagent. Runs the agent as a
    // persistent teammate and notifies the lead via SendMessage / mailbox upon completion.
    if (teamName && this.teamManager && this.teamRunAgentFactory) {
      return await this.runAsTeammate(
        teamName,
        description,
        prompt,
        args.plan_mode_required === true,
        isolation === "worktree",
      );
    }

    // Fork path: Inherits parent conversation context when subagent_type is not specified
    if (!subagentType) {
      return this.runFork(prompt, description, modelOverride);
    }

    // Definition path: Look up Agent definition by subagent_type
    const definition = this.definitions.find((d) => d.name === subagentType);
    if (!definition) {
      return {
        output: `Error: unknown agent type '${subagentType}'. Available: ${this.definitions.map((d) => d.name).join(", ")}`,
        isError: true,
      };
    }

    // Worktree isolation: provision a separate working copy for the child agent; its changes
    // land on its own branch and cannot collide with the parent or other parallel child agents.
    let effectivePrompt = prompt;
    let workDirOverride: string | undefined;
    if (isolation === "worktree" || definition.isolation === "worktree") {
      try {
        const wt = await createAgentWorktree(newAgentSlug());
        workDirOverride = wt.path;
        effectivePrompt = `${buildWorktreeNotice(this.workDir, wt.path)}

${prompt}`;
      } catch (e) {
        return { output: `Error creating agent worktree: ${asErrorString(e)}`, isError: true };
      }
    }

    try {
      const output = await this.spawnHandler(
        definition,
        effectivePrompt,
        background || !!definition.background,
        modelOverride,
        workDirOverride,
      );
      return { output, isError: false };
    } catch (err) {
      return {
        output: `Agent error: ${asErrorString(err)}`,
        isError: true,
      };
    }
  }

  /**
   * Team-member mode: Spawns a persistent teammate in the specified team.
   * Delegates to Team.spawnTeammate() to start the idle-poll main loop.
   */
  private async runAsTeammate(
    teamName: string,
    description: string,
    prompt: string,
    planModeRequired: boolean,
    worktreeIsolation: boolean,
  ): Promise<ToolResult> {
    if (!this.teamManager) {
      return {
        output: `Error: team manager '${teamName}' not found.`,
        isError: true,
      };
    }
    // If the team does not exist, create one on the fly: in coordinator mode TeamCreate is not
    // in the allowlist, so requiring the lead to create a team first would block at step one.
    const team =
      this.teamManager.get(teamName) ??
      this.teamManager.create(teamName, undefined, {
        leadAgentId: "lead",
        description,
      });

    // Derive teammate name from description and deduplicate
    let memberName = description.replace(/\s+/g, "-").toLowerCase().slice(0, 30);
    let suffix = 2;
    const base = memberName;
    while (team.getMember(memberName)) {
      memberName = `${base}-${String(suffix++)}`;
    }

    // Build a teammate-scoped tool registry: clone the parent registry, then
    // inject team-level task tools and a named SendMessage (overriding the
    // inherited personal version so teammates share the same task list).
    // Two categories are excluded during cloning: tools no subagent should
    // have, and team membership management tools reserved for the Lead.
    const teammateRegistry = new ToolRegistry();
    for (const tool of this.registry.listTools()) {
      if (ALL_AGENT_DISALLOWED_TOOLS.has(tool.name)) {
        continue;
      }
      if (TEAMMATE_DISALLOWED_TOOLS.has(tool.name)) {
        continue;
      }
      teammateRegistry.register(tool);
    }
    teammateRegistry.register(new SendMessageTool(this.teamManager, memberName));
    teammateRegistry.register(new TaskCreateTool(this.teamManager, teamName, memberName));
    teammateRegistry.register(new TaskGetTool(this.teamManager, teamName));
    teammateRegistry.register(new TaskListTool(this.teamManager, teamName));
    teammateRegistry.register(new TaskUpdateTool(this.teamManager, teamName));
    // The plan-mode teammate requires the checker to be created here: after team-level approval
    // passes, the mode must be switched back to default in place. If the checker were created
    // only inside spawnSubAgent, no one would have a handle to modify it.
    const checker = planModeRequired ? new PermissionChecker(this.workDir, "plan") : undefined;

    // Worktree isolation: the teammate works on its own branch; changes are merged back during convergence
    let teammatePrompt = prompt;
    if (worktreeIsolation) {
      try {
        const wt = await createAgentWorktree(newAgentSlug());
        team.setMemberMeta(memberName, { worktreePath: wt.path });
        teammatePrompt = `${buildWorktreeNotice(this.workDir, wt.path)}

${prompt}`;
      } catch (e) {
        return {
          output: `Error creating teammate worktree: ${asErrorString(e)}`,
          isError: true,
        };
      }
    }

    const runAgent = this.teamRunAgentFactory?.(teammateRegistry, checker);

    if (runAgent) {
      team.spawnTeammate(memberName, teammatePrompt, runAgent, checker);
    }

    return {
      output: `Teammate '${memberName}' spawned in team '${teamName}' (mode: ${team.mode})${planModeRequired ? ", starting in plan mode" : ""}.
        The teammate is now working on the assigned task.`,
      isError: false,
    };
  }

  /**
   * Fork mode: Inherits parent conversation context and runs in the background.
   * Unlike definition mode, the forked subagent can see the full history of the parent conversation,
   * achieving byte alignment for the prompt-cache prefix to improve cache hit rate.
   */
  private async runFork(
    prompt: string,
    description: string,
    modelOverride: string,
  ): Promise<ToolResult> {
    if (!this.conversation || !this.forkHandler) {
      return {
        output: "Error: fork requires parent conversation context",
        isError: true,
      };
    }

    // Nested fork detection — dual-layer protection:
    // (1) Primary check: querySource flag (detectable even if the conversation is compressed)
    // (2) Fallback: scan conversation history for fork markers
    if (this.querySource === FORK_QUERY_SOURCE) {
      return {
        output:
          "Error: cannot fork from a forked agent. Use subagent_type to spawn a definition-based agent instead.",
        isError: true,
      };
    }
    for (const msg of this.conversation.getMessages()) {
      if (msg.content.includes(FORK_BOILERPLATE_TAG)) {
        return {
          output:
            "Error: cannot fork from a forked agent. Use subagent_type to spawn a definition-based agent instead.",
          isError: true,
        };
      }
    }

    try {
      const { cloneRegistryForFork } = await import("./tool-filter.js");
      const forkedRegistry = cloneRegistryForFork(this.registry);
      /** const output = */ await this.forkHandler(
        `${FORK_BOILERPLATE}\n\nYour task:\n${prompt}`,
        this.conversation,
        forkedRegistry,
        modelOverride,
      );
      return {
        output: `Forked agent "${description}" launched in background. Results will arrive via task-notification.`,
        isError: false,
      };
    } catch (err) {
      log.error({ err }, "subagent operation failed");
      return {
        output: `Fork error: ${asErrorString(err)}`,
        isError: true,
      };
    }
  }
}
