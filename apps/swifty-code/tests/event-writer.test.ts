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
import { EventWriter } from "../src/core/events/writer.js";
import { EventBus } from "../src/core/events/bus.js";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("EventWriter", () => {
  // Feature: Verify EventWriter writes events to JSONL file
  // Design: Create writer, publish event, read file, confirm event is written
  test("writes events to file", async () => {
    const dir = path.join(tmpdir(), `test-events-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "events.jsonl");
    const writer = new EventWriter(filePath);
    writer.open();

    const bus = new EventBus();
    writer.subscribe(bus);

    await bus.publish({
      type: "run.started",
      run_id: "r1",
      goal: "test goal",
      timestamp: new Date().toISOString(),
    });

    writer.close();

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("run.started");
    expect(content).toContain("test goal");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify EventWriter creates parent directories
  // Design: Create writer with nested path, confirm directories are created
  test("creates parent directories", () => {
    const baseDir = path.join(tmpdir(), `test-events-${String(Date.now())}`);
    const dir = path.join(baseDir, "nested", "dir");
    const filePath = path.join(dir, "events.jsonl");
    const writer = new EventWriter(filePath);
    writer.open();
    expect(existsSync(dir)).toBe(true);
    writer.close();
    rmSync(baseDir, { recursive: true });
  });

  // Feature: Verify EventWriter handles multiple events
  // Design: Publish multiple events, confirm all are written
  test("handles multiple events", async () => {
    const dir = path.join(tmpdir(), `test-events-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "events.jsonl");
    const writer = new EventWriter(filePath);
    writer.open();

    const bus = new EventBus();
    writer.subscribe(bus);

    await bus.publish({
      type: "run.started",
      run_id: "r1",
      goal: "goal 1",
      timestamp: new Date().toISOString(),
    });
    await bus.publish({
      type: "run.started",
      run_id: "r2",
      goal: "goal 2",
      timestamp: new Date().toISOString(),
    });

    writer.close();

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
    rmSync(dir, { recursive: true });
  });
});
