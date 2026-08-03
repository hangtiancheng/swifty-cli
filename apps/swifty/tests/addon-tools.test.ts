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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { GlobTool } from "../src/tools/addon/glob.js";
import { GrepTool } from "../src/tools/addon/grep.js";
import type { ToolContext } from "../src/tools/types.js";

const workDir = mkdtempSync(join(tmpdir(), "swifty-addon-tools-"));
mkdirSync(join(workDir, "src", "js"), { recursive: true });
mkdirSync(join(workDir, "src", "md"), { recursive: true });
mkdirSync(join(workDir, "node_modules", "pkg"), { recursive: true });
writeFileSync(join(workDir, "main.js"), "console.log('entry');\n");
writeFileSync(
  join(workDir, "src", "js", "promise.js"),
  "class PromiseV2 {}\nconst PENDING = 'pending';\n",
);
writeFileSync(join(workDir, "src", "js", "curry.js"), "function curry(fn) {}\n");
writeFileSync(join(workDir, "src", "md", "notes.md"), "function notes() {}\n");
writeFileSync(join(workDir, "node_modules", "pkg", "index.js"), "function hidden() {}\n");

const ctx: ToolContext = { workDir };

const lines = (output: string | Record<string, unknown>[]): string[] => {
  if (typeof output !== "string") {
    throw new Error("expected string output");
  }
  return output.split("\n");
};

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("GrepTool include filter", () => {
  const grep = new GrepTool();

  it("matches include patterns containing path separators", async () => {
    const res = await grep.execute(ctx, {
      pattern: "^(function|class|const|async function) ",
      include: "src/js/*.js",
    });
    expect(res.isError).toBe(false);
    expect(res.output).toContain("src/js/promise.js:1:class PromiseV2 {}");
    expect(res.output).toContain("src/js/curry.js:1:function curry(fn) {}");
    expect(res.output).not.toContain("main.js");
    expect(res.output).not.toContain("No matches found.");
  });

  it("matches an exact relative file path as include", async () => {
    const res = await grep.execute(ctx, {
      pattern: "const",
      include: "src/js/promise.js",
    });
    expect(res.output).toBe("src/js/promise.js:2:const PENDING = 'pending';");
  });

  it("matches bare include patterns at any depth and skips node_modules", async () => {
    const res = await grep.execute(ctx, { pattern: "function|console", include: "*.js" });
    expect(res.output).toContain("main.js:1:console.log('entry');");
    expect(res.output).toContain("src/js/curry.js:1:function curry(fn) {}");
    expect(res.output).not.toContain("node_modules");
  });

  it("supports brace include patterns", async () => {
    const res = await grep.execute(ctx, { pattern: "function", include: "*.{js,md}" });
    expect(res.output).toContain("src/md/notes.md:1:function notes() {}");
    expect(res.output).toContain("src/js/curry.js:1:function curry(fn) {}");
  });

  it("matches case-insensitively", async () => {
    const res = await grep.execute(ctx, { pattern: "CLASS PROMISEV2", include: "*.js" });
    expect(res.output).toContain("src/js/promise.js:1:class PromiseV2 {}");
  });

  it("resolves relative path args against workDir", async () => {
    const res = await grep.execute(ctx, { pattern: "curry", path: "src/js" });
    expect(res.output).toContain("src/js/curry.js:1:function curry(fn) {}");
  });
});

describe("GlobTool", () => {
  const glob = new GlobTool();

  it("matches path patterns", async () => {
    const res = await glob.execute(ctx, { pattern: "src/js/*.js" });
    expect(res.isError).toBe(false);
    expect(lines(res.output).sort()).toEqual(["src/js/curry.js", "src/js/promise.js"]);
  });

  it("matches ** recursively and skips node_modules", async () => {
    const res = await glob.execute(ctx, { pattern: "**/*.js" });
    const matched = lines(res.output);
    expect(matched).toContain("main.js");
    expect(matched).toContain("src/js/promise.js");
    expect(matched.some((l) => l.startsWith("node_modules"))).toBe(false);
  });

  it("matches brace patterns", async () => {
    const res = await glob.execute(ctx, { pattern: "*.{js,md}" });
    const matched = lines(res.output);
    expect(matched).toContain("src/md/notes.md");
    expect(matched).toContain("main.js");
  });

  it("reports when nothing matches", async () => {
    const res = await glob.execute(ctx, { pattern: "*.rs" });
    expect(res.output).toBe("No files matched the pattern.");
  });
});
