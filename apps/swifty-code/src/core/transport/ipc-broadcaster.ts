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

// IPC event broadcaster: manages subscriptions and fans out events to matching clients
import { randomUUID } from "node:crypto";
import type net from "node:net";

import picomatch from "picomatch";

import type { Event } from "../bus/events.js";
import type { TraceWriter } from "../trace/writer.js";
import { makePushTrace } from "../trace/record.js";
import { getLogger } from "../logging.js";

interface Subscription {
  subId: string;
  socket: net.Socket;
  topics: string[];
  scope: string;
  matchers: picomatch.Matcher[];
  // B-10: per-socket serial write queue (promise chain). Events for this
  // socket are delivered in order, but a slow socket (backpressure) never
  // blocks the event bus or other subscribers.
  writeQueue: Promise<void>;
}

// Write a JSON line to a socket
function writeLine(socket: net.Socket, data: unknown): boolean {
  return socket.write(JSON.stringify(data) + "\n", "utf-8");
}

// Return peer address string for trace client_id (matches Python peername)
function peerAddress(socket: net.Socket): string {
  const addr = socket.remoteAddress;
  const port = socket.remotePort;
  if (addr && port) return `${addr}:${String(port)}`;
  return "<unknown>";
}

export class IpcEventBroadcaster {
  private _subscriptions: Subscription[] = [];
  private _trace: TraceWriter | undefined;

  constructor(options?: { trace?: TraceWriter }) {
    this._trace = options?.trace;
  }

  // Register a client subscription; returns subscription_id
  subscribe(socket: net.Socket, topics: string[], scope = "global"): string {
    const subId = `sub-${randomUUID().slice(0, 8)}`;
    const matchers = topics.map((t) => picomatch(t));
    const sub: Subscription = {
      subId,
      socket,
      topics,
      scope,
      matchers,
      writeQueue: Promise.resolve(),
    };
    this._subscriptions.push(sub);
    return subId;
  }

  // Remove all subscriptions for a given socket
  unsubscribe(socket: net.Socket): void {
    this._subscriptions = this._subscriptions.filter((s) => s.socket !== socket);
  }

  // Number of live subscriptions (B-3: used to detect "no client left to
  // answer permission requests" after a disconnect)
  subscriptionCount(): number {
    return this._subscriptions.length;
  }

  // Push event to all matching subscribers.
  // B-10: each matching subscription gets the write enqueued on its own serial
  // queue and handle() returns without waiting for the writes, so a slow
  // socket (backpressure) never blocks the event bus or other subscribers.
  // Per-socket event order is preserved by the promise chain; a failed write
  // still triggers the dead-socket cleanup (unsubscribe).
  async handle(event: Event): Promise<void> {
    const eventType = event.type;
    const runId = "run_id" in event ? event.run_id : undefined;

    for (const sub of [...this._subscriptions]) {
      if (!this._matchesTopic(eventType, sub.matchers)) continue;
      if (!this._matchesScope(runId, sub.scope)) continue;

      sub.writeQueue = sub.writeQueue
        .then(() => this._deliver(sub, event, eventType, runId))
        .catch((err: unknown) => {
          // Write failed: drop the dead subscriber; later events skip it
          getLogger().debug(`broadcaster: dropping dead subscriber: ${String(err)}`);
          this.unsubscribe(sub.socket);
        });
    }
    await Promise.resolve();
  }

  // Write one event envelope to a subscriber; awaits drain under backpressure
  // but bails out (rejects) if the socket errors/closes so the queue never
  // stalls forever on a dead connection
  private async _deliver(
    sub: Subscription,
    event: Event,
    eventType: string,
    runId: string | undefined,
  ): Promise<void> {
    const envelope = { kind: "event" as const, event };
    const ok = writeLine(sub.socket, envelope);
    if (!ok) {
      // Backpressure: wait for drain
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          sub.socket.off("drain", onDrain);
          sub.socket.off("error", onError);
          sub.socket.off("close", onClose);
        };
        const onDrain = (): void => {
          cleanup();
          resolve();
        };
        const onError = (err: Error): void => {
          cleanup();
          reject(err);
        };
        const onClose = (): void => {
          cleanup();
          reject(new Error("socket closed while awaiting drain"));
        };
        sub.socket.once("drain", onDrain);
        sub.socket.once("error", onError);
        sub.socket.once("close", onClose);
      });
    }
    // Trace: CORE->CLIENT push
    if (this._trace) {
      this._trace.emit(
        makePushTrace(
          peerAddress(sub.socket),
          typeof runId === "string" ? runId : null,
          sub.subId,
          eventType,
        ),
      );
    }
  }

  // Check if event type matches any of the subscription's topic matchers
  private _matchesTopic(eventType: string, matchers: picomatch.Matcher[]): boolean {
    return matchers.some((m) => m(eventType));
  }

  // Check if the event's run_id matches the subscription scope
  private _matchesScope(runId: string | undefined, scope: string): boolean {
    if (scope === "global") return true;
    if (scope.startsWith("run:")) return runId === scope.slice(4);
    return false;
  }
}
