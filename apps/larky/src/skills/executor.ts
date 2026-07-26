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

import type { Skill, SkillHost, SkillForkHost } from "./skill.js";

/**
 * Runs a skill in inline mode: injects the skill body into the current conversation context.
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
