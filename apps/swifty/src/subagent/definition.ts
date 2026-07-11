import type { PermissionMode } from "../permissions/checker.js";

export interface AgentDefinition {
  name: string;
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  systemPromptOverride?: string;
  maxTurns?: number;
  model?: string;
  permissionMode?: PermissionMode;
  background?: boolean;
  isolation?: "worktree";
  initialPrompt?: string;
  omitMarkdown?: boolean;
  skills?: string[];
  memory?: boolean;
  mcpServers?: string[];
}

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: "general-purpose",
    description:
      "General-purpose agent for researching complex questions, exploring codebase, and executing multi-step tasks.",
  },
  {
    name: "plan",
    description: `You are a software architect. This is a read-only planning task.
Prohibited actions:
Creating, modifying, or deleting files, Asking questions
Workflow:
1. Understand user requirements
2. Explore the codebase to understand project conventions and development paradigms
3. Design the solution
4. Output the plan, define milestones, and identify risks
`,
    disallowedTools: ["EditFile", "WriteFile"],
    permissionMode: "plan",
  },
  {
    name: "explore",
    description: `You are a code exploration expert. This is a read-only exploration task.
Prohibited actions:
Creating, modifying, or deleting files, Asking questions
Tool invocation strategy:
- Use Glob to search for files
- Use Grep to search for content
- Use ReadFile to read files at specified paths
- Only execute read-only Bash commands
- Invoke multiple tools in parallel whenever possible to maximize efficiency
`,
    disallowedTools: ["EditFile", "WriteFile"],
    permissionMode: "plan",
    model: "haiku",
  },
];
