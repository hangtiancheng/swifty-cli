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

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandAtRefs } from "../src/tui/at-expand.js";

describe("@file mention expansion", () => {
  it("inline a referenced file's contents", () => {
    const workDir = mkdtempSync(join(tmpdir(), "swifty-at-"));
    writeFileSync(join(workDir, "notes.md"), "hello from notes");

    const out = expandAtRefs("please read @notes.md and summarize", workDir);
    expect(out).toContain("please read @notes.md and summarize");
    expect(out).toContain('<file path="notes.md">');
    expect(out).toContain("hello from notes");
  });

  it("leaves non-file @tokens untouched", () => {
    const workDir = mkdtempSync(join(tmpdir(), "swifty-at-"));
    const text = "ping @alice about @nonexistent.txt";
    expect(expandAtRefs(text, workDir)).toBe(text);
  });

  it("returns the text unchanged when there are no @refs", () => {
    const workDir = mkdtempSync(join(tmpdir(), "swifty-at-"));
    expect(expandAtRefs("just a plain message", workDir)).toBe("just a plain message");
  });

  it("de-duplicates repeated references", () => {
    const workDir = mkdtempSync(join(tmpdir(), "swifty-at-"));
    writeFileSync(join(workDir, "a.txt"), "AAA");
    const out = expandAtRefs("@a.txt and again @a.txt", workDir);
    expect(out.match(/<file path="a.txt">/g)?.length).toBe(1);
  });
});
