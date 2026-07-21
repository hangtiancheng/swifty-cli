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
import { NoteSaveTool } from "../src/core/tools/builtin/note-save.js";
import { SessionStore } from "../src/core/session/store.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("NoteSaveTool", () => {
  // Feature: Verify NoteSaveTool saves notes
  // Design: Create tool with session store, save note, confirm it's stored
  test("saves notes", async () => {
    const dir = path.join(tmpdir(), `test-notes-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const sessionId = "session-1";
    const runId = "run-1";

    const tool = new NoteSaveTool(store, sessionId, runId);
    const result = await tool.invoke({ content: "Important note" });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("saved");

    const notes = store.readNotes(sessionId);
    expect(notes).toContain("Important note");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify NoteSaveTool rejects empty content
  // Design: Save empty note, confirm error
  test("rejects empty content", async () => {
    const dir = path.join(tmpdir(), `test-notes-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const sessionId = "session-1";
    const runId = "run-1";

    const tool = new NoteSaveTool(store, sessionId, runId);
    const result = await tool.invoke({ content: "" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("empty");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify NoteSaveTool trims whitespace
  // Design: Save note with whitespace, confirm it's trimmed
  test("trims whitespace", async () => {
    const dir = path.join(tmpdir(), `test-notes-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const store = new SessionStore(dir);
    const sessionId = "session-1";
    const runId = "run-1";

    const tool = new NoteSaveTool(store, sessionId, runId);
    const result = await tool.invoke({ content: "  trimmed note  " });
    expect(result.isError).toBe(false);

    const notes = store.readNotes(sessionId);
    expect(notes).toContain("trimmed note");
    rmSync(dir, { recursive: true });
  });
});
