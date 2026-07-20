import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "subagent" });

import type { Tool, ToolResult, ToolContext, ToolSchema } from "../tools/types.js";
import type { AgentDefinition } from "./definition.js";
import { loadAgentDefinitions } from "./loader.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ConversationManager } from "../conversation/conversation.js";
import type { TeamManager, RunAgent } from "../teams/team.js";
import { asErrorString, boolArg, strArg } from "@/utils/index.js";
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from "../teams/task-tools.js";
import { SendMessageTool } from "../teams/tools.js";

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
  system = true;

  private definitions: AgentDefinition[];
  private registry: ToolRegistry;
  private conversation?: ConversationManager;

  // Identifies the derived context of the current AgentTool instance;
  // re-forking is prohibited when non-empty and equal to FORK_QUERY_SOURCE
  querySource = "";

  /** Optional: Team manager, enables the team_name parameter. */
  private teamManager?: TeamManager;
  /**
   * Optional: factory that produces a per-teammate RunAgent. Receives a
   * teammate-scoped tool registry (with shared task-board tools injected)
   * and returns the callback that runs the teammate agent's main loop.
   */
  private teamRunAgentFactory?: (registry: ToolRegistry) => RunAgent;

  private spawnHandler: (
    definition: AgentDefinition,
    prompt: string,
    background: boolean,
    modelOverride?: string,
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
    this.registry = registry;
    this.spawnHandler = spawnHandler;
    this.conversation = conversation;
    this.forkHandler = forkHandler;
  }

  /**
   * Sets the team manager and teammate run callback, enabling the team_name parameter.
   * Once configured, the Agent tool can spawn teammates directly without requiring a separate SpawnTeammate tool.
   */
  setTeamManager(mgr: TeamManager, runAgentFactory: (registry: ToolRegistry) => RunAgent): void {
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

    const subagentType = strArg(args, "subagent_type");
    const modelOverride = strArg(args, "model");
    const background = boolArg(args, "run_in_background");
    const teamName = strArg(args, "team_name");

    // Team-member path: team_name takes precedence over fork/subagent. Runs the agent as a
    // persistent teammate and notifies the lead via SendMessage / mailbox upon completion.
    if (teamName && this.teamManager && this.teamRunAgentFactory) {
      return this.runAsTeammate(teamName, description, prompt);
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

    try {
      const output = await this.spawnHandler(
        definition,
        prompt,
        background || !!definition.background,
        modelOverride,
      );
      return { output, isError: false };
    } catch (err) {
      log.error({ err }, "subagent operation failed");
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
  private runAsTeammate(teamName: string, description: string, prompt: string): ToolResult {
    const team = this.teamManager?.get(teamName);
    if (!team) {
      return {
        output: `Error: team '${teamName}' not found. Create it first with TeamCreate.`,
        isError: true,
      };
    }

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
    const teammateRegistry = new ToolRegistry();
    for (const tool of this.registry.listTools()) {
      teammateRegistry.register(tool);
    }
    if (this.teamManager) {
      teammateRegistry.register(new SendMessageTool(this.teamManager, memberName));
      teammateRegistry.register(new TaskCreateTool(this.teamManager, teamName, memberName));
      teammateRegistry.register(new TaskGetTool(this.teamManager, teamName));
      teammateRegistry.register(new TaskListTool(this.teamManager, teamName));
      teammateRegistry.register(new TaskUpdateTool(this.teamManager, teamName));
    }
    const runAgent = this.teamRunAgentFactory?.(teammateRegistry);
    if (runAgent) {
      team.spawnTeammate(memberName, prompt, runAgent);
    }

    return {
      output:
        `Teammate '${memberName}' spawned in team '${teamName}' (mode: ${team.mode}). ` +
        `The teammate is now working on the assigned task.`,
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
