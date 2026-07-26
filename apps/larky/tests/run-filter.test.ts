/** P0-5 regression tests: stale-run event filtering on the TUI client. */
import { describe, it, expect } from "vitest";

import type { Event } from "../src/core/bus/events.js";
import { advanceReplayCursor, isStaleRunEvent } from "../src/tui/run-filter.js";

const TS = "2026-07-26T00:00:00.000Z";

function streamText(runId: string): Event {
  return {
    type: "agent.stream_text",
    session_id: "sess-1",
    run_id: runId,
    text: "x",
    timestamp: TS,
  };
}

describe("isStaleRunEvent", () => {
  it("drops agent events from a superseded run", () => {
    expect(isStaleRunEvent(streamText("run-old"), "run-new")).toBe(true);
    const loopComplete: Event = {
      type: "agent.loop_complete",
      session_id: "sess-1",
      run_id: "run-old",
      stop_reason: "interrupted",
      total_turns: 1,
      elapsed_ms: 10,
      timestamp: TS,
    };
    expect(isStaleRunEvent(loopComplete, "run-new")).toBe(true);
  });

  it("keeps agent events of the current run", () => {
    expect(isStaleRunEvent(streamText("run-new"), "run-new")).toBe(false);
  });

  it("keeps run_id:'' events (skill fork output)", () => {
    expect(isStaleRunEvent(streamText(""), "run-new")).toBe(false);
  });

  it("keeps everything before the first run.started (currentRunId null)", () => {
    expect(isStaleRunEvent(streamText("run-any"), null)).toBe(false);
  });

  it("keeps run.started so the current-run pointer can advance", () => {
    const runStarted: Event = {
      type: "run.started",
      session_id: "sess-1",
      run_id: "run-old",
      content: "hello",
      origin: "client",
      timestamp: TS,
    };
    expect(isStaleRunEvent(runStarted, "run-new")).toBe(false);
  });

  it("keeps non-agent events regardless of run", () => {
    const permissionRequested: Event = {
      type: "permission.requested",
      id: "perm-1",
      session_id: "sess-1",
      run_id: "run-old",
      tool_name: "Bash",
      args: {},
      reason: "",
      timestamp: TS,
    };
    expect(isStaleRunEvent(permissionRequested, "run-new")).toBe(false);
    const systemMessage: Event = {
      type: "system.message",
      session_id: "sess-1",
      message: "hi",
      timestamp: TS,
    };
    expect(isStaleRunEvent(systemMessage, "run-new")).toBe(false);
  });
});

describe("advanceReplayCursor", () => {
  const SESS = "sess-1";

  it("resets to 1 on our session's run.started (line 1 of the run file)", () => {
    const raw = { type: "run.started", session_id: SESS, run_id: "run-a" };
    expect(advanceReplayCursor(raw, SESS, null, 7)).toBe(1);
  });

  it("ignores run.started of other sessions and of the unknown-session window", () => {
    const raw = { type: "run.started", session_id: "sess-other", run_id: "run-x" };
    expect(advanceReplayCursor(raw, SESS, "run-a", 3)).toBe(3);
    // sessionId unknown (startup / reset): never reset the cursor.
    expect(advanceReplayCursor({ ...raw, session_id: SESS }, "", "run-a", 3)).toBe(3);
  });

  it("advances on any current-run event, including unknown future types", () => {
    expect(
      advanceReplayCursor({ type: "agent.stream_text", run_id: "run-a" }, SESS, "run-a", 1),
    ).toBe(2);
    // Unknown event type (would fail schema parse) still counts — the daemon
    // persists it, so the cursor must move in lockstep.
    expect(
      advanceReplayCursor({ type: "agent.some_future_event", run_id: "run-a" }, SESS, "run-a", 2),
    ).toBe(3);
  });

  it("does not advance for other runs or run-less events", () => {
    expect(
      advanceReplayCursor({ type: "agent.stream_text", run_id: "run-old" }, SESS, "run-a", 5),
    ).toBe(5);
    expect(advanceReplayCursor({ type: "system.message" }, SESS, "run-a", 5)).toBe(5);
    expect(advanceReplayCursor({ type: "agent.stream_text", run_id: "" }, SESS, "run-a", 5)).toBe(
      5,
    );
  });
});
