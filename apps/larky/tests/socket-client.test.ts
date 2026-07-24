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
import { SocketClient } from "../src/core/transport/socket-client.js";
import { SocketServer } from "../src/core/transport/socket-server.js";
import net from "node:net";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.entries());
  }
  return {};
}

describe("SocketClient", () => {
  // Feature: Verify SocketClient connects to server
  // Design: Start server, create client, connect, confirm connection succeeds
  test("connects to server", async () => {
    const port = await getFreePort();
    const server = new SocketServer("127.0.0.1", port);
    await server.start();

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    client.close();
    await server.stop();
  });

  // Feature: Verify SocketClient sends commands and receives responses
  // Design: Register handler on server, send command from client, confirm response
  test("sends commands and receives responses", async () => {
    const port = await getFreePort();
    const server = new SocketServer("127.0.0.1", port);
    server.register("test.method", () => Promise.resolve({ result: "success" }));
    await server.start();

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    const response = await client.sendCommand("test.method", {
      param: "value",
    });
    expect(response["result"]).toBe("success");

    client.close();
    await server.stop();
  });

  // Feature: Verify SocketClient handles errors
  // Design: Send command to non-existent method, confirm error is thrown
  test("handles errors", async () => {
    const port = await getFreePort();
    const server = new SocketServer("127.0.0.1", port);
    await server.start();

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    await expect(client.sendCommand("nonexistent.method", {})).rejects.toThrow();

    client.close();
    await server.stop();
  });

  // Feature: Verify SocketClient receives events
  // Design: Register event handler, subscribe to events, have server push an event, confirm client receives it
  test("receives events", async () => {
    const port = await getFreePort();
    const server = new SocketServer("127.0.0.1", port);
    const broadcaster = new (
      await import("../src/core/transport/ipc-broadcaster.js")
    ).IpcEventBroadcaster();
    await server.start();

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    const events: unknown[] = [];
    client.onEvent((event) => {
      events.push(event);
      return Promise.resolve();
    });

    // Subscribe to all events
    const writer = (await import("../src/core/transport/socket-server.js")).getConnectionWriter;

    server.register("event.subscribe", async () => {
      const socket = writer();
      broadcaster.subscribe(socket, ["*"], "global");
      return Promise.resolve({ subscription_id: "sub-1", replayed_count: 0 });
    });

    await client.sendCommand("event.subscribe", { topics: ["*"] });

    // Push an event via broadcaster
    await broadcaster.handle({
      type: "session.created",
      session_id: "test-session",
      mode: "chat",
      timestamp: new Date().toISOString(),
    });

    // Wait a bit for the event to be received
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events.length).toBeGreaterThan(0);
    const testEvent = events.find((e: unknown) => asRecord(e)["type"] === "session.created");
    expect(testEvent).toBeDefined();

    client.close();
    await server.stop();
  });

  // Feature: Verify waitForDisconnect resolves when server stops
  // Design: Connect client, stop server, confirm waitForDisconnect resolves
  test("waitForDisconnect resolves on server stop", async () => {
    const port = await getFreePort();
    const server = new SocketServer("127.0.0.1", port);
    await server.start();

    const client = new SocketClient("127.0.0.1", port);
    await client.connect();

    const disconnectPromise = client.waitForDisconnect();

    // Stop server after a short delay
    setTimeout(() => void server.stop(), 50);

    await disconnectPromise;
    // If we get here, the promise resolved - test passes
    client.close();
  });

  // Feature: Verify sendCommand before connect throws
  // Design: Create client, try to send command without connecting, expect error
  test("sendCommand before connect throws", async () => {
    const client = new SocketClient("127.0.0.1", 9999);

    await expect(client.sendCommand("test.method", {})).rejects.toThrow("not connected");
  });
});

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}
