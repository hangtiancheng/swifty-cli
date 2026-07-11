import type { Skill, SkillHost, SkillForkHost } from "./skill.js";

/**
 * Runs a skill in inline mode: injects the skill body into the current conversation context.
 *
 * Fail-fast: Throws an error if any tools in allowedTools are unregistered,
 * without activating the skill or installing filters. It is better to detect missing dependencies at call time rather than during execution.
 */
export function runInline(skill: Skill, args: string, host: SkillHost): string {
  // Replace the $ARGUMENTS placeholder in the body; if no placeholder exists, append the user request
  let body = skill.body;
  if (body.includes("$ARGUMENTS")) {
    body = body.replaceAll("$ARGUMENTS", args);
  } else if (args) {
    body += `\n\nUser Request: ${args}`;
  }

  host.activateSkill(skill.meta.name, body);
  return body;
}

/**
 * Runs a skill in fork mode: executes it in an isolated subagent.
 */
export async function runFork(skill: Skill, args: string, host: SkillForkHost): Promise<string> {
  let prompt = skill.body;
  if (args) {
    prompt += `\n\nARGUMENTS: ${args}`;
  }

  // Determine how much parent conversation context to carry based on forkContext configuration
  const contextMode = skill.meta.forkContext ?? "none";
  if (contextMode === "recent") {
    const context = host.snapshotParentMessages(5);
    prompt = `Context from parent conversation:\n${context}\n\n${prompt}`;
  } else if (contextMode === "full") {
    const context = host.snapshotParentMessages(100);
    prompt = `Context from parent conversation:\n${context}\n\n${prompt}`;
  }

  return host.runSubagent(prompt);
}
