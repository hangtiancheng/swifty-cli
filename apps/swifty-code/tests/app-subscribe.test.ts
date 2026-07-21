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

// Feature (B-11): event.subscribe must snapshot replay history synchronously
// and register the live subscription with no await gap, so events published
// right after subscription registration are never lost in a replay/subscribe
// window.
// Design: exercise the extracted handleEventSubscribe / snapshotReplayLinesFromFile
// functions from app.ts with mock sockets and an injected snapshot function.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { handleEventSubscribe, snapshotReplayLinesFromFile } from "../src/core/app.js";
import { IpcEventBroadcaster } from "../src/core/transport/ipc-broadcaster.js";
import { isRecord } from "../src/core/bus/envelope.js";

// Mock socket capturing writes (same approach as ipc-broadcaster tests)
function makeMockSocket(): { socket: net.Socket; writes: string[] } {
  const socket = new net.Socket();
  const writes: string[] = [];
  socket.write = (chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  return { socket, writes };
}

// Let queued microtasks/macrotasks settle (broadcaster writes are queued)
async function flushTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// Parse an envelope write and return event.type (empty string if not parseable)
function envelopeEventField(raw: string, field: string): string {
  const parsed: unknown = JSON.parse(raw.trim());
  if (!isRecord(parsed)) return "";
  const event = parsed["event"];
  return isRecord(event) && typeof event[field] === "string" ? event[field] : "";
}

describe("handleEventSubscribe (B-11)", () => {
  // Feature: events published immediately after handleEventSubscribe is
  // invoked (i.e. during the replay write-out phase) are delivered — the old
  // "replay with awaits, then subscribe" flow lost them
  test("no events lost between replay snapshot and live subscription", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const { socket, writes } = makeMockSocket();

    const replayLine =
      JSON.stringify({
        kind: "event",
        event: { type: "run.started", run_id: "replayed-run" },
      }) + "\n";

    const resultPromise = handleEventSubscribe(
      broadcaster,
      socket,
      { topics: ["run.*"], scope: "global", replay_from_run: "replayed-run" },
      () => [replayLine],
    );

    // Published synchronously after the call — with the old flow the
    // subscription would not exist yet and this event would be lost
    const livePromise = broadcaster.handle({
      type: "run.started",
      run_id: "live-run",
      goal: "test",
      timestamp: "2026-01-01T00:00:00Z",
    });

    const result = await resultPromise;
    await livePromise;
    await flushTasks();

    expect(writes).toHaveLength(2);
    expect(envelopeEventField(writes[0], "run_id")).toBe("replayed-run");
    expect(envelopeEventField(writes[1], "run_id")).toBe("live-run");

    if (!isRecord(result)) throw new Error("unexpected result shape");
    expect(result["replayed_count"]).toBe(1);
    expect(typeof result["subscription_id"]).toBe("string");
  });

  // Feature: replay_from_run=null skips replay and still subscribes
  test("subscribe without replay delivers live events", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const { socket, writes } = makeMockSocket();

    const result = await handleEventSubscribe(broadcaster, socket, {
      topics: ["run.*"],
      scope: "global",
      replay_from_run: null,
    });

    await broadcaster.handle({
      type: "run.started",
      run_id: "r1",
      goal: "test",
      timestamp: "2026-01-01T00:00:00Z",
    });
    await flushTasks();

    if (!isRecord(result)) throw new Error("unexpected result shape");
    expect(result["replayed_count"]).toBe(0);
    expect(writes).toHaveLength(1);
    expect(envelopeEventField(writes[0], "type")).toBe("run.started");
  });
});

describe("snapshotReplayLinesFromFile (B-11)", () => {
  // Feature: synchronous snapshot filters by topic and skips malformed lines
  test("filters by topic and skips malformed lines", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "swifty-replay-"));
    try {
      const eventsPath = path.join(dir, "events.jsonl");
      const lines = [
        JSON.stringify({ type: "run.started", run_id: "r1" }),
        JSON.stringify({ type: "step.started", run_id: "r1", step: 1 }),
        "not valid json",
        JSON.stringify({ type: "run.completed", run_id: "r1" }),
        "",
      ].join("\n");
      writeFileSync(eventsPath, lines, "utf-8");

      const out = snapshotReplayLinesFromFile(eventsPath, ["run.*"]);
      expect(out).toHaveLength(2);
      expect(envelopeEventField(out[0], "type")).toBe("run.started");
      expect(envelopeEventField(out[1], "type")).toBe("run.completed");
      // Each snapshot line is a complete "\n"-terminated envelope
      for (const line of out) {
        expect(line.endsWith("\n")).toBe(true);
        const parsed: unknown = JSON.parse(line.trim());
        expect(isRecord(parsed) ? parsed["kind"] : undefined).toBe("event");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: missing file yields an empty snapshot
  test("returns empty array for missing file", () => {
    const out = snapshotReplayLinesFromFile("/tmp/nonexistent-swifty-events.jsonl", ["*"]);
    expect(out).toEqual([]);
  });
});
