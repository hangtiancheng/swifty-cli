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

import { describe, expect, test } from "vitest";
import { PromptBuilder, buildSystemPrompt, detectEnvironment } from "../src/core/prompt/builder.js";
import { environmentSection } from "../src/core/prompt/sections.js";

describe("PromptBuilder", () => {
  // Feature: build joins sections sorted by ascending priority
  // Design: Add sections out of order, verify output order follows priority
  test("build sorts sections by priority", () => {
    const b = new PromptBuilder();
    b.add({ name: "B", priority: 20, content: "second" });
    b.add({ name: "A", priority: 10, content: "first" });
    b.add({ name: "C", priority: 30, content: "third" });
    expect(b.build()).toBe("first\n\nsecond\n\nthird");
  });

  // Feature: build drops empty sections
  // Design: Add a whitespace-only section, verify it is filtered out
  test("build filters empty sections", () => {
    const b = new PromptBuilder();
    b.add({ name: "A", priority: 0, content: "content" });
    b.add({ name: "Empty", priority: 10, content: "   " });
    expect(b.build()).toBe("content");
  });
});

describe("buildSystemPrompt", () => {
  // Feature: assembled prompt contains all migrated sections in order
  // Design: Build with a synthetic environment, verify key section markers
  test("contains identity, behavior and environment sections", () => {
    const env = {
      workDir: "/tmp/proj",
      os: "darwin",
      arch: "arm64",
      shell: "/bin/zsh",
      isGitRepo: true,
      gitBranch: "main",
      model: "claude-test",
      date: "2026-01-01",
    };
    const prompt = buildSystemPrompt(env);

    expect(prompt).toContain("You are Larky");
    expect(prompt).toContain("# System");
    expect(prompt).toContain("# Task Execution");
    expect(prompt).toContain("# Exercise Caution When Executing Actions");
    expect(prompt).toContain("# Using Your Tools");
    expect(prompt).toContain("# Tone and Style");
    expect(prompt).toContain("# Text Output");
    expect(prompt).toContain("# Environment");
    expect(prompt).toContain("Working directory: /tmp/proj");
    expect(prompt).toContain("Git branch: main");
    expect(prompt).toContain("Model: claude-test");
    // Identity must come before Environment (priority order)
    expect(prompt.indexOf("You are Larky")).toBeLessThan(prompt.indexOf("# Environment"));
  });

  // Feature: tool guidance references larky snake_case tool names
  // Design: Verify migrated Using Tools section names actual larky tools
  test("references larky tool names", () => {
    const prompt = buildSystemPrompt(detectEnvironment(process.cwd()));
    for (const name of ["read_file", "write_file", "list_dir", "task_create", "spawn_agent"]) {
      expect(prompt).toContain(name);
    }
  });
});

describe("detectEnvironment", () => {
  // Feature: environment detection reads git state from the filesystem
  // Design: Run against this repository, verify git repo detection and date format
  test("detects git repo and formats date", () => {
    const env = detectEnvironment(process.cwd());
    expect(env.isGitRepo).toBe(true);
    expect(env.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(env.workDir).toBe(process.cwd());
  });

  // Feature: non-repo directories report isGitRepo=false
  // Design: Use the filesystem root, which is never a git repo
  test("reports non-repo for filesystem root", () => {
    const env = detectEnvironment("/");
    expect(env.isGitRepo).toBe(false);
    expect(env.gitBranch).toBe("");
  });
});

describe("environmentSection", () => {
  // Feature: branch and model lines are omitted when absent
  // Design: Build with empty branch/model, verify lines are missing
  test("omits branch and model lines when empty", () => {
    const section = environmentSection({
      workDir: "/tmp",
      os: "linux",
      arch: "x64",
      shell: "bash",
      isGitRepo: false,
      gitBranch: "",
      model: "",
      date: "2026-01-01",
    });
    expect(section.content).not.toContain("Git branch");
    expect(section.content).not.toContain("Model:");
    expect(section.content).toContain("Git repository: false");
  });
});
