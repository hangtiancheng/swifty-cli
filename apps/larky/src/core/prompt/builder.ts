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

// PromptBuilder: assembles the base system prompt from priority-ordered sections
import { existsSync, readFileSync } from "node:fs";
import { platform, arch } from "node:os";
import path from "node:path";

import type { Section, EnvironmentContext } from "./sections.js";
import {
  identitySection,
  systemSection,
  doingTasksSection,
  executingActionsSection,
  usingToolsSection,
  toneStyleSection,
  outputEfficiencySection,
  environmentSection,
} from "./sections.js";

export class PromptBuilder {
  private _sections: Section[] = [];

  add(s: Section): this {
    this._sections.push(s);
    return this;
  }

  build(): string {
    const sorted = [...this._sections].sort((a, b) => a.priority - b.priority);
    return sorted
      .map((s) => s.content.trim())
      .filter(Boolean)
      .join("\n\n");
  }
}

// Read the current branch from .git/HEAD without spawning a subprocess.
// Walks up parent directories to find the repository root.
function readGitBranch(workDir: string): { isGitRepo: boolean; branch: string } {
  let dir = path.resolve(workDir);
  for (;;) {
    const headPath = path.join(dir, ".git", "HEAD");
    if (existsSync(headPath)) {
      try {
        const head = readFileSync(headPath, "utf-8").trim();
        const match = /^ref: refs\/heads\/(.+)$/.exec(head);
        // Detached HEAD: report repo without a branch name
        return { isGitRepo: true, branch: match ? match[1] : "" };
      } catch {
        return { isGitRepo: true, branch: "" };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return { isGitRepo: false, branch: "" };
    dir = parent;
  }
}

export function detectEnvironment(workDir: string, model = ""): EnvironmentContext {
  const git = readGitBranch(workDir);
  return {
    workDir,
    os: platform(),
    arch: arch(),
    shell: process.env["SHELL"] ?? "bash",
    isGitRepo: git.isGitRepo,
    gitBranch: git.branch,
    model,
    date: new Date().toISOString().split("T")[0],
  };
}

export function buildSystemPrompt(env: EnvironmentContext): string {
  const b = new PromptBuilder();
  b.add(identitySection());
  b.add(systemSection());
  b.add(doingTasksSection());
  b.add(executingActionsSection());
  b.add(usingToolsSection());
  b.add(toneStyleSection());
  b.add(outputEfficiencySection());
  b.add(environmentSection(env));
  return b.build();
}
