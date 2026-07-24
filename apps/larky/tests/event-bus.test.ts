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

// Feature: Verify in-process EventBus publish/subscribe pattern
// Design: Cover single subscriber, multiple subscribers, ordering guarantees, empty bus scenarios
import { describe, expect, test } from "vitest";

import type { Event } from "../src/core/bus/events.js";
import { EventBus } from "../src/core/events/bus.js";

// Create fake event for testing
function makeFakeEvent(): Event {
  return {
    type: "run.started",
    run_id: "r1",
    goal: "test",
    timestamp: "2026-01-01T00:00:00Z",
  };
}

describe("EventBus", () => {
  // Feature: Verify subscribers receive event object after publish
  // Design: Use inline handler to collect event references, exclude serialization intermediate steps
  test("publish reaches subscriber", async () => {
    const bus = new EventBus();
    const received: Event[] = [];

    bus.subscribe((event) => {
      received.push(event);
      return Promise.resolve();
    });

    const event = makeFakeEvent();
    await bus.publish(event);
    expect(received).toEqual([event]);
  });

  // Feature: Verify multiple subscribers independently receive the same event
  // Design: Two independent counters accumulate separately, avoiding shared state masking uncalled subscribers
  test("multiple subscribers all receive", async () => {
    const bus = new EventBus();
    const counts = [0, 0];

    bus.subscribe(() => {
      counts[0]++;
      return Promise.resolve();
    });
    bus.subscribe(() => {
      counts[1]++;
      return Promise.resolve();
    });

    await bus.publish(makeFakeEvent());
    expect(counts).toEqual([1, 1]);
  });

  // Feature: Verify multiple subscribers are called in registration order
  // Design: Record call order by appending integers to a list
  test("subscribers called in order", async () => {
    const bus = new EventBus();
    const order: number[] = [];

    bus.subscribe(() => {
      order.push(1);
      return Promise.resolve();
    });
    bus.subscribe(() => {
      order.push(2);
      return Promise.resolve();
    });

    await bus.publish(makeFakeEvent());
    expect(order).toEqual([1, 2]);
  });

  // Feature: Verify publish does not throw when no subscribers exist
  // Design: Only call publish, use "no exception raised" as the sole pass criterion
  test("no subscribers publish is noop", async () => {
    const bus = new EventBus();
    await bus.publish(makeFakeEvent()); // should not raise
  });
});
