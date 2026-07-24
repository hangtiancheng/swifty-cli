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
import { loadContextFile } from "../src/core/memory/loader.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("loadContextFile", () => {
  // Feature: Verify loading existing context file returns its content
  // Design: Create temp file with content, load it, confirm content matches
  test("loads existing file", () => {
    const dir = path.join(tmpdir(), `test-context-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "context.md");
    writeFileSync(filePath, "# Context\nThis is test context.", "utf-8");
    const content = loadContextFile(filePath);
    expect(content).toContain("This is test context");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify loading non-existent file returns empty string
  // Design: Query non-existent path, confirm empty string is returned
  test("returns empty string for non-existent file", () => {
    const filePath = path.join(tmpdir(), "nonexistent-context.md");
    const content = loadContextFile(filePath);
    expect(content).toBe("");
  });

  // Feature: Verify loading empty file returns empty string
  // Design: Create empty file, load it, confirm empty string is returned
  test("returns empty string for empty file", () => {
    const dir = path.join(tmpdir(), `test-context-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "empty-context.md");
    writeFileSync(filePath, "", "utf-8");
    const content = loadContextFile(filePath);
    expect(content).toBe("");
    rmSync(dir, { recursive: true });
  });
});
