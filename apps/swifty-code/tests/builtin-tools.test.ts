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
import {
  BashTool,
  ReadFileTool,
  WriteFileTool,
  ListDirTool,
} from "../src/core/tools/builtin/index.js";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("Builtin Tools", () => {
  describe("BashTool", () => {
    // Feature: Verify BashTool executes simple commands
    // Design: Run echo command, confirm output matches
    test("executes simple commands", async () => {
      const tool = new BashTool();
      const result = await tool.invoke({ command: "echo hello" });
      expect(result.isError).toBe(false);
      expect(result.content.trim()).toBe("hello");
    });

    // Feature: Verify BashTool captures stderr
    // Design: Run command that writes to stderr, confirm it's captured
    test("captures stderr", async () => {
      const tool = new BashTool();
      const result = await tool.invoke({ command: "echo error >&2" });
      expect(result.isError).toBe(false);
      expect(result.content.trim()).toBe("error");
    });

    // Feature: Verify BashTool returns error for non-zero exit
    // Design: Run failing command, confirm isError is true
    test("returns error for non-zero exit", async () => {
      const tool = new BashTool();
      const result = await tool.invoke({ command: "exit 1" });
      expect(result.isError).toBe(true);
      expect(result.content).toContain("exit 1");
    });

    // Feature: Verify BashTool kills process with SIGKILL on timeout
    // Design: Run sleep with timeout=1, verify timeout error and no lingering process
    test("kills process on timeout", async () => {
      const tool = new BashTool();
      const start = Date.now();
      const result = await tool.invoke({ command: "sleep 100", timeout: 1 });
      const elapsed = Date.now() - start;

      // Should return within ~2s (1s timeout + overhead), not 100s
      expect(elapsed).toBeLessThan(5000);
      expect(result.isError).toBe(true);
      expect(result.errorType).toBe("timeout");
      expect(result.content).toContain("timeout");
    });

    // Feature (B-7): timeout returns partial output collected before the kill
    // Design: Emit output then hang; confirm partial output is preserved with
    //         a trailing timeout marker and errorType stays "timeout"
    test("returns partial output on timeout", async () => {
      const tool = new BashTool();
      const result = await tool.invoke({
        command: "echo partial-line-1; echo partial-line-2; sleep 100",
        timeout: 1,
      });
      expect(result.isError).toBe(true);
      expect(result.errorType).toBe("timeout");
      expect(result.content).toContain("partial-line-1");
      expect(result.content).toContain("partial-line-2");
      expect(result.content.endsWith("[timeout after 1s]")).toBe(true);
    }, 10_000);

    // Feature (B-7): partial output on timeout still respects the 64 KB cap
    // Design: Emit ~1 MB then hang; confirm truncation marker + timeout marker
    test("truncates partial output on timeout at 64 KB", async () => {
      const tool = new BashTool();
      const result = await tool.invoke({
        command: "yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2>/dev/null | head -c 1048576; sleep 100",
        timeout: 1,
      });
      expect(result.isError).toBe(true);
      expect(result.errorType).toBe("timeout");
      expect(result.content).toContain("[truncated]");
      expect(result.content.endsWith("[timeout after 1s]")).toBe(true);
      // 64 KB cap + truncation and timeout markers (small slack)
      expect(result.content.length).toBeLessThanOrEqual(64 * 1024 + 64);
    }, 10_000);

    // Feature: Verify BashTool caps accumulated output at 64 KB
    // Design: Emit ~1 MB of output, confirm result is truncated with marker
    test("truncates output at 64 KB", async () => {
      const tool = new BashTool();
      // Emit ~1 MB of 'a' characters
      const result = await tool.invoke({
        command: 'yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2>/dev/null | head -c 1048576; exit 0',
      });
      expect(result.isError).toBe(false);
      expect(result.content).toContain("[truncated]");
      // 64 KB cap + truncation marker (small slack for the marker line)
      expect(result.content.length).toBeLessThanOrEqual(64 * 1024 + 32);
    });
  });

  describe("ReadFileTool", () => {
    // Feature: Verify ReadFileTool reads file contents
    // Design: Create temp file, read it, confirm content matches
    test("reads file contents", async () => {
      const dir = path.join(tmpdir(), `test-read-${String(Date.now())}`);
      mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, "test.txt");
      writeFileSync(filePath, "test content", "utf-8");

      const tool = new ReadFileTool();
      const result = await tool.invoke({ path: filePath });
      expect(result.isError).toBe(false);
      expect(result.content).toBe("test content");
      rmSync(dir, { recursive: true });
    });

    // Feature: Verify ReadFileTool returns error for non-existent file
    // Design: Read non-existent file, confirm isError is true
    test("returns error for non-existent file", async () => {
      const tool = new ReadFileTool();
      const result = await tool.invoke({ path: "/nonexistent/file.txt" });
      expect(result.isError).toBe(true);
    });
  });

  describe("WriteFileTool", () => {
    // Feature: Verify WriteFileTool creates files
    // Design: Write to new file, read it back, confirm content matches
    test("creates files", async () => {
      const dir = path.join(tmpdir(), `test-write-${String(Date.now())}`);
      mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, "test.txt");

      const tool = new WriteFileTool();
      const result = await tool.invoke({
        path: filePath,
        content: "written content",
      });
      expect(result.isError).toBe(false);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toBe("written content");
      rmSync(dir, { recursive: true });
    });

    // Feature: Verify WriteFileTool creates parent directories
    // Design: Write to nested path, confirm parent dirs are created
    test("creates parent directories", async () => {
      const baseDir = path.join(tmpdir(), `test-write-${String(Date.now())}`);
      const dir = path.join(baseDir, "nested", "dir");
      const filePath = path.join(dir, "test.txt");

      const tool = new WriteFileTool();
      const result = await tool.invoke({ path: filePath, content: "nested" });
      expect(result.isError).toBe(false);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toBe("nested");
      rmSync(baseDir, { recursive: true });
    });
  });

  describe("ListDirTool", () => {
    // Feature: Verify ListDirTool lists directory contents
    // Design: Create temp dir with files, list it, confirm files are listed
    test("lists directory contents", async () => {
      const dir = path.join(tmpdir(), `test-list-${String(Date.now())}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "file1.txt"), "content1", "utf-8");
      writeFileSync(path.join(dir, "file2.txt"), "content2", "utf-8");

      const tool = new ListDirTool();
      const result = await tool.invoke({ path: dir });
      expect(result.isError).toBe(false);
      expect(result.content).toContain("file1.txt");
      expect(result.content).toContain("file2.txt");
      rmSync(dir, { recursive: true });
    });

    // Feature: Verify ListDirTool respects max_depth
    // Design: Create nested dirs, list with max_depth=1, confirm only top level is listed
    test("respects max_depth", async () => {
      const dir = path.join(tmpdir(), `test-list-${String(Date.now())}`);
      const nested = path.join(dir, "nested");
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(nested, "deep.txt"), "content", "utf-8");

      const tool = new ListDirTool();
      const result = await tool.invoke({ path: dir, max_depth: 1 });
      expect(result.isError).toBe(false);
      expect(result.content).toContain("nested");
      rmSync(dir, { recursive: true });
    });

    // Feature: Verify ListDirTool returns clear error for non-existent directory
    // Design: List a missing path, expect "no such directory" with the original input path
    test("returns error for non-existent directory", async () => {
      const missing = path.join(tmpdir(), `test-list-missing-${String(Date.now())}`);
      const tool = new ListDirTool();
      const result = await tool.invoke({ path: missing });
      expect(result.isError).toBe(true);
      expect(result.errorType).toBe("runtime_error");
      expect(result.content).toBe(`no such directory: ${missing}`);
    });

    // Feature: Verify ListDirTool returns clear error when path is a file
    // Design: List a file path, expect "not a directory" with the original input path
    test("returns error when path is not a directory", async () => {
      const dir = path.join(tmpdir(), `test-list-file-${String(Date.now())}`);
      mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, "file.txt");
      writeFileSync(filePath, "content", "utf-8");

      const tool = new ListDirTool();
      const result = await tool.invoke({ path: filePath });
      expect(result.isError).toBe(true);
      expect(result.errorType).toBe("runtime_error");
      expect(result.content).toBe(`not a directory: ${filePath}`);
      rmSync(dir, { recursive: true });
    });

    // Feature: Verify ListDirTool rejects path traversal with a toolError
    // Design: Pass a path containing "..", expect runtime_error result (not a throw)
    test("returns error for path traversal", async () => {
      const tool = new ListDirTool();
      const result = await tool.invoke({ path: "../outside" });
      expect(result.isError).toBe(true);
      expect(result.errorType).toBe("runtime_error");
      expect(result.content).toContain("path traversal not allowed");
    });
  });
});
