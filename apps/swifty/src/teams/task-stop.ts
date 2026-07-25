import type { TeamManager } from "./team.js";
import type { Tool, ToolCategory, ToolContext, ToolResult, ToolSchema } from "../tools/types.js";
import { strArg } from "@/utils";

/**
 * Abort a running teammate.
 * Use this to cut losses early when the Coordinator dispatched in the wrong direction,
 * rather than waiting for the teammate to finish misguided work.
 *
 * Wired to TeamManager instead of the background task table: in coordinator mode the Lead
 * dispatches teammates whose cancel handles are held by the Team — they don't appear in
 * the background task table.
 */
export class TaskStopTool implements Tool {
  name = "TaskStop";
  description =
    "Stop a running teammate. Pass the teammate name as it appears in the from= field of a team-notification. " +
    "Use this when you sent a teammate in the wrong direction — for example when the user " +
    "changes requirements after you launched it.";
  category: ToolCategory = "command";

  constructor(private teamManager: TeamManager) {}

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          teammate: {
            type: "string",
            description:
              "Name of the teammate to stop, exactly as it appears in the from= field of a team-notification",
          },
        },
        required: ["teammate"],
      },
    };
  }

  async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const name = strArg(args, "teammate", "");
    if (!name) {
      return { output: "Error: teammate is required", isError: true };
    }

    // Teammate names may collide across teams; only stop within the team that actually has this member to avoid killing a namesake
    for (const team of this.teamManager.list()) {
      const member = team.members.get(name);
      if (!member) {
        continue;
      }

      if (!member.active) {
        return {
          output: `Teammate '${name}' in team '${team.name}' is not running, nothing to stop`,
          isError: false,
        };
      }
      await team.stopMember(name);
      return {
        output: `Teammate '${name}' in team '${team.name}' stopped.`,
        isError: false,
      };
    }

    return {
      output: `Error: teammate '${name}' not found. Known teammates: ${this.knownMembers()}`,
      isError: true,
    };
  }

  /** List all current teammate names for the model, so it doesn't keep retrying with a misremembered name */
  private knownMembers(): string {
    const names: string[] = [];
    for (const team of this.teamManager.list()) {
      for (const memberName of team.members.keys()) {
        names.push(memberName);
      }
    }
    return names.length > 0 ? names.join(", ") : "(none)";
  }
}
