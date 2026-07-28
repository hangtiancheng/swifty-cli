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

import type { Event } from "../core/bus/events.js";

/**
 * Steering multiplexes two runs' events over one session stream: the old
 * run's tail (e.g. its interrupted agent.loop_complete) always arrives after
 * the new run.started. Stale agent.* events must not touch the new run's UI.
 *
 * Exemptions:
 * - run_id === "" is never stale (defensive: no current emit site produces
 *   an empty run_id, but a run-less agent event must not be dropped);
 * - run.started itself is the source of the current-run pointer;
 * - non-agent events (system.message, permission.requested, ...) pass through.
 */
export function isStaleRunEvent(event: Event, currentRunId: string | null): boolean {
  if (currentRunId === null) {
    return false;
  }
  if (!event.type.startsWith("agent.")) {
    return false;
  }
  if (!("run_id" in event) || event.run_id === "") {
    return false;
  }
  return event.run_id !== currentRunId;
}

/**
 * Replay-cursor advance, computed on the RAW wire object before schema
 * parsing. The daemon persists every non-empty-run_id line schema-agnostically
 * (core/app.ts _persistEvent), so unknown/future event types must still
 * advance the cursor — otherwise a reconnect replays already-applied events.
 *
 * Rules (mirroring the daemon's per-run events.jsonl line order):
 * - run.started of OUR session resets the cursor to 1 (it is line 1);
 * - any other event of the current run advances by 1;
 * - everything else leaves the cursor unchanged.
 */
export function advanceReplayCursor(
  raw: Record<string, unknown>,
  sessionId: string,
  currentRunId: string | null,
  count: number,
): number {
  const runId = typeof raw.run_id === "string" ? raw.run_id : "";
  if (!runId) {
    return count;
  }
  if (raw.type === "run.started") {
    const sess = typeof raw.session_id === "string" ? raw.session_id : "";
    return sessionId !== "" && sess === sessionId ? 1 : count;
  }
  return runId === currentRunId ? count + 1 : count;
}
