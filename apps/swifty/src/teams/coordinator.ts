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

import type { TeamManager } from "./team.js";

// CoordinatorMode restricts the Lead agent's tools to coordination-only.
// When active, Lead can only use: Agent, SendMessage, and task management
// tools (TaskCreate, TaskGet, TaskList, TaskUpdate), plus read-only
// investigation tools (ReadFile, Glob, Grep, Bash).
//
// The four-phase workflow:
// 1. Research: Lead explores the problem space
// 2. Synthesis: Lead creates a plan and task decomposition
// 3. Implementation: Lead spawns teammates to execute tasks
// 4. Verification: Lead verifies results and resolves conflicts

const COORDINATOR_ALLOWED_TOOLS = new Set([
  "Agent",
  "SendMessage",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",

  "TeamCreate",
  "TeamDelete",
  "ListTeams",
  "SpawnTeammate",

  "ReadFile",
  "Glob",
  "Grep",
  "Bash",
]);

/** Check if a tool is allowed in Coordinator Mode. */
export function isCoordinatorTool(name: string): boolean {
  return COORDINATOR_ALLOWED_TOOLS.has(name);
}

/**
 * Returns a per-iteration tool predicate for the main (Lead) agent.
 * While at least one team exists, the Lead is restricted to
 * COORDINATOR_ALLOWED_TOOLS so it delegates work instead of doing it
 * itself; when teams are all torn down, the full tool set is restored
 * on the next iteration. MCP tools (prefixed "mcp__") are always allowed.
 */
export function coordinatorToolFilter(
  teamMgr: TeamManager,
  enabled = false,
): (name: string) => boolean {
  return (name: string): boolean => {
    if (!enabled) {
      return true;
    }
    if (teamMgr.list().length === 0) {
      return true;
    }
    if (name.startsWith("mcp__")) {
      return true;
    }
    return isCoordinatorTool(name);
  };
}
