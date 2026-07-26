import type { Event } from "../core/bus/events.js";

/**
 * Steering multiplexes two runs' events over one session stream: the old
 * run's tail (e.g. its interrupted agent.loop_complete) always arrives after
 * the new run.started. Stale agent.* events must not touch the new run's UI.
 *
 * Exemptions:
 * - run_id === "" (skill fork output) is never stale;
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
