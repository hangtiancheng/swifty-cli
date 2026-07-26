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

// Feature: event.subscribe replay (B-11) against the new wire protocol events
// Design: write agent events to a temp events.jsonl, snapshot with topic
// filters, and verify handleEventSubscribe replays before live subscription
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

import { describe, expect, test } from "vitest";

import { snapshotReplayLinesFromFile, handleEventSubscribe } from "../src/core/app.js";
import { IpcEventBroadcaster } from "../src/core/transport/ipc-broadcaster.js";

// Create mock socket for testing — uses real Socket instance for type safety
function makeMockSocket(writes: string[]): net.Socket {
  const socket = new net.Socket();
  socket.write = (chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  return socket;
}

function writeEventsFile(lines: unknown[]): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "larky-replay-"));
  const file = path.join(dir, "events.jsonl");
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  return { dir, file };
}

const RUN_EVENTS = [
  {
    type: "run.started",
    session_id: "s1",
    run_id: "r1",
    content: "hello",
    timestamp: "2026-01-01T00:00:00Z",
  },
  {
    type: "agent.stream_text",
    session_id: "s1",
    run_id: "r1",
    text: "hi",
    timestamp: "2026-01-01T00:00:01Z",
  },
  {
    type: "agent.loop_complete",
    session_id: "s1",
    run_id: "r1",
    stop_reason: "end_turn",
    total_turns: 1,
    elapsed_ms: 10,
    timestamp: "2026-01-01T00:00:02Z",
  },
];

describe("replay snapshot", () => {
  test("snapshotReplayLinesFromFile filters by topic glob", () => {
    const { dir, file } = writeEventsFile(RUN_EVENTS);
    try {
      const all = snapshotReplayLinesFromFile(file, ["*"]);
      expect(all.length).toBe(3);

      const agentOnly = snapshotReplayLinesFromFile(file, ["agent.*"]);
      expect(agentOnly.length).toBe(2);

      // Envelope shape: {kind: "event", event: {...}}
      const parsed: unknown = JSON.parse(agentOnly[0]);
      expect(parsed).toMatchObject({
        kind: "event",
        event: { type: "agent.stream_text", run_id: "r1" },
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("snapshotReplayLinesFromFile returns [] for missing file", () => {
    expect(snapshotReplayLinesFromFile("/nonexistent/events.jsonl", ["*"])).toEqual([]);
  });

  test("handleEventSubscribe replays snapshot then subscribes", async () => {
    const { dir, file } = writeEventsFile(RUN_EVENTS);
    try {
      const broadcaster = new IpcEventBroadcaster();
      const writes: string[] = [];
      const fakeSocket = makeMockSocket(writes);

      const result = await handleEventSubscribe(
        broadcaster,
        fakeSocket,
        { topics: ["agent.*"], scope: "global", replay_from_run: "r1" },
        (_runId, topics) => snapshotReplayLinesFromFile(file, topics),
      );

      expect(result).toMatchObject({ replayed_count: 2 });
      expect(writes.length).toBe(2);
      expect(broadcaster.subscriptionCount()).toBe(1);

      // Live event after subscribe still delivered
      await broadcaster.handle({
        type: "agent.stream_text",
        session_id: "s1",
        run_id: "r2",
        text: "live",
        timestamp: "2026-01-01T00:01:00Z",
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writes.length).toBe(3);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("broadcaster session scope", () => {
  test("scope session:<id> filters other sessions", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const writes: string[] = [];
    const fakeSocket = makeMockSocket(writes);

    broadcaster.subscribe(fakeSocket, ["*"], "session:s1");

    await broadcaster.handle({
      type: "system.message",
      session_id: "s1",
      message: "mine",
      timestamp: "2026-01-01T00:00:00Z",
    });
    await broadcaster.handle({
      type: "system.message",
      session_id: "s2",
      message: "other",
      timestamp: "2026-01-01T00:00:00Z",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(writes.length).toBe(1);
    expect(writes[0]).toContain("mine");
  });
});
