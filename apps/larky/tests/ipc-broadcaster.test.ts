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

// Feature: Verify IpcEventBroadcaster subscription, topic matching, scope filtering, disconnect cleanup
// Design: Use mock net.Socket to capture write data, avoiding real TCP connection complexity
import net from "node:net";

import { describe, expect, test } from "vitest";

import type { Event } from "../src/core/bus/events.js";
import { IpcEventBroadcaster } from "../src/core/transport/ipc-broadcaster.js";
import { isRecord } from "../src/core/bus/envelope.js";

// Write tracker to capture socket write calls without type assertions
interface WriteTracker {
  data: string[];
}

// WeakMap to associate sockets with their write trackers
const trackerRegistry = new WeakMap<net.Socket, WriteTracker>();

// Create mock socket for testing — uses real Socket instance for type safety
function makeMockSocket(): net.Socket {
  const socket = new net.Socket();
  const tracker: WriteTracker = { data: [] };
  socket.write = (chunk: string | Uint8Array): boolean => {
    tracker.data.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  trackerRegistry.set(socket, tracker);
  return socket;
}

// Create a mock socket that always reports backpressure (write returns false).
// Deliveries stay queued until the test emits "drain" on the socket.
function makeBackpressureSocket(): net.Socket {
  const socket = new net.Socket();
  const tracker: WriteTracker = { data: [] };
  socket.write = (chunk: string | Uint8Array): boolean => {
    tracker.data.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return false;
  };
  trackerRegistry.set(socket, tracker);
  return socket;
}

// Create a mock socket whose write always throws (dead connection)
function makeThrowingSocket(): net.Socket {
  const socket = new net.Socket();
  const tracker: WriteTracker = { data: [] };
  socket.write = (): boolean => {
    throw new Error("broken pipe");
  };
  trackerRegistry.set(socket, tracker);
  return socket;
}

// Let queued microtasks/macrotasks settle (per-socket write queues run async)
async function flushTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// Create RunStartedEvent for testing
function makeRunStarted(runId = "r1"): Event {
  return {
    type: "run.started",
    run_id: runId,
    goal: "test",
    timestamp: "2026-01-01T00:00:00Z",
  };
}

// Create StepStartedEvent for testing
function makeStepStarted(runId = "r1"): Event {
  return {
    type: "step.started",
    run_id: runId,
    step: 1,
    timestamp: "2026-01-01T00:00:00Z",
  };
}

// Retrieve the write tracker for a socket
function getTracker(socket: net.Socket): WriteTracker {
  const tracker = trackerRegistry.get(socket);
  if (!tracker) throw new Error("no tracker registered for socket");
  return tracker;
}

// Type-safe helper to parse the first write call as JSON
function getWriteCallData(socket: net.Socket): Record<string, unknown> | null {
  const tracker = getTracker(socket);
  if (tracker.data.length === 0) return null;
  const first = tracker.data[0];
  const parsed: unknown = JSON.parse(first.trim());
  if (!isRecord(parsed)) return null;
  return parsed;
}

// Type-safe helper to get write call count
function getWriteCallCount(socket: net.Socket): number {
  return getTracker(socket).data.length;
}

describe("IpcEventBroadcaster", () => {
  // Feature: Verify subscribe then handle writes matching topic events to socket
  // Design: Use mock socket to capture write data, deserialize and assert kind and event.type
  test("subscriber receives matching event", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["run.*"]);

    await broadcaster.handle(makeRunStarted());
    await flushTasks(); // B-10: deliveries are queued per socket

    expect(getWriteCallCount(socket)).toBe(1);
    const data = getWriteCallData(socket);
    if (!data) throw new Error("write not called");
    expect(data["kind"]).toBe("event");
    const event = data["event"];
    expect(isRecord(event) ? event["type"] : undefined).toBe("run.started");
  });

  // Feature: Verify handle does not write to any socket when no subscriptions exist
  // Design: Create broadcaster without subscribing, call handle and assert write was never called
  test("no subscription means no write", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();

    await broadcaster.handle(makeRunStarted());

    expect(getWriteCallCount(socket)).toBe(0);
  });

  // Feature: Verify topic glob "step.*" matches step.started but not run.started
  // Design: Publish both event types to same broadcaster, assert write called only once
  test("topic glob matches step but not run", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["step.*"]);

    await broadcaster.handle(makeStepStarted());
    await broadcaster.handle(makeRunStarted());
    await flushTasks(); // B-10: deliveries are queued per socket

    expect(getWriteCallCount(socket)).toBe(1);
  });

  // Feature: Verify scope="global" subscription receives events from any run_id
  // Design: Publish two events with different run_ids, assert both writes occur
  test("scope global receives all run_ids", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["run.*"], "global");

    await broadcaster.handle(makeRunStarted("r1"));
    await broadcaster.handle(makeRunStarted("r2"));
    await flushTasks(); // B-10: deliveries are queued per socket

    expect(getWriteCallCount(socket)).toBe(2);
  });

  // Feature: Verify scope="run:<id>" only receives events with matching run_id
  // Design: Subscribe with scope="run:abc", publish run_id="abc" and run_id="xyz", assert only one write
  test("scope run:<id> filters other run_ids", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["run.*"], "run:abc");

    await broadcaster.handle(makeRunStarted("abc"));
    await broadcaster.handle(makeRunStarted("xyz"));
    await flushTasks(); // B-10: deliveries are queued per socket

    expect(getWriteCallCount(socket)).toBe(1);
  });

  // Feature: Verify unsubscribe stops handle from sending events to that socket
  // Design: Subscribe then unsubscribe, call handle, assert write was never called
  test("unsubscribe stops delivery", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["run.*"]);
    broadcaster.unsubscribe(socket);

    await broadcaster.handle(makeRunStarted());
    await flushTasks(); // B-10: deliveries are queued per socket

    expect(getWriteCallCount(socket)).toBe(0);
  });

  // Feature (B-3): subscriptionCount reflects subscribe/unsubscribe
  // Design: Subscribe two sockets, unsubscribe one, verify count at each step
  test("subscriptionCount tracks subscribe and unsubscribe", () => {
    const broadcaster = new IpcEventBroadcaster();
    const a = makeMockSocket();
    const b = makeMockSocket();
    expect(broadcaster.subscriptionCount()).toBe(0);
    broadcaster.subscribe(a, ["run.*"]);
    broadcaster.subscribe(b, ["run.*"]);
    expect(broadcaster.subscriptionCount()).toBe(2);
    broadcaster.unsubscribe(a);
    expect(broadcaster.subscriptionCount()).toBe(1);
    broadcaster.unsubscribe(b);
    expect(broadcaster.subscriptionCount()).toBe(0);
  });

  // Feature (B-10): a slow subscriber (backpressure, drain pending) must not
  // block handle() nor delivery to other subscribers
  // Design: slow socket's write returns false and drain never fires during the
  // test; with the old sequential-await handle() this test would hang forever.
  test("slow subscriber does not block handle or other subscribers", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const slow = makeBackpressureSocket();
    const fast = makeMockSocket();
    broadcaster.subscribe(slow, ["run.*"]);
    broadcaster.subscribe(fast, ["run.*"]);

    // Would deadlock pre-B-10: handle awaited slow socket's drain inline
    await broadcaster.handle(makeRunStarted("r1"));
    await broadcaster.handle(makeRunStarted("r2"));
    await flushTasks();

    // Fast socket got both events even though slow socket is still draining
    expect(getWriteCallCount(fast)).toBe(2);
    // Slow socket has the first write buffered, second queued behind drain
    expect(getWriteCallCount(slow)).toBe(1);
  });

  // Feature (B-10): per-socket event order is preserved by the write queue
  // Design: enqueue two events against a backpressured socket, release drain
  // step by step, then assert both events arrived in publish order
  test("per-socket order preserved under backpressure", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const slow = makeBackpressureSocket();
    broadcaster.subscribe(slow, ["run.*"]);

    await broadcaster.handle(makeRunStarted("first"));
    await broadcaster.handle(makeRunStarted("second"));
    await flushTasks();
    expect(getWriteCallCount(slow)).toBe(1);

    // Release the first delivery; the queued second delivery follows
    slow.emit("drain");
    await flushTasks();
    expect(getWriteCallCount(slow)).toBe(2);

    const tracker = getTracker(slow);
    const runIds = tracker.data.map((raw) => {
      const parsed: unknown = JSON.parse(raw.trim());
      if (!isRecord(parsed)) return "";
      const event = parsed["event"];
      return isRecord(event) && typeof event["run_id"] === "string" ? event["run_id"] : "";
    });
    expect(runIds).toEqual(["first", "second"]);
  });

  // Feature (B-10): write failure still triggers dead-socket cleanup
  // Design: throwing socket is unsubscribed after a failed queued delivery,
  // while a healthy subscriber keeps receiving events
  test("write failure removes dead subscriber and keeps others", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const dead = makeThrowingSocket();
    const alive = makeMockSocket();
    broadcaster.subscribe(dead, ["run.*"]);
    broadcaster.subscribe(alive, ["run.*"]);

    await broadcaster.handle(makeRunStarted("r1"));
    await flushTasks();

    expect(broadcaster.subscriptionCount()).toBe(1);
    await broadcaster.handle(makeRunStarted("r2"));
    await flushTasks();
    expect(getWriteCallCount(alive)).toBe(2);
  });
});
