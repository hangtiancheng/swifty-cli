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

// Feature: Verify SocketServer basic start/stop and connection cleanup
// Design: Use real TCP connections to verify server lifecycle behavior
import net from "node:net";
import { z } from "zod";

import { afterEach, describe, expect, test } from "vitest";

import { SocketServer, getConnectionWriter } from "../src/core/transport/socket-server.js";
import { IpcEventBroadcaster } from "../src/core/transport/ipc-broadcaster.js";
import { PermissionManager } from "../src/core/permissions/manager.js";
import { isRecord } from "../src/core/bus/envelope.js";

// Get a random available port
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      s.close(() => {
        resolve(port);
      });
    });
  });
}

// Type-safe helper to parse JSON-RPC response
function parseResponse(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("invalid JSON-RPC response");
  return parsed;
}

// Type-safe helper to extract result from parsed response
function getResult(resp: Record<string, unknown>): Record<string, unknown> {
  const result = resp["result"];
  if (!isRecord(result)) throw new Error("missing result in response");
  return result;
}

// Type-safe helper to extract error from parsed response
function getError(resp: Record<string, unknown>): Record<string, unknown> {
  const error = resp["error"];
  if (!isRecord(error)) throw new Error("missing error in response");
  return error;
}

describe("SocketServer", () => {
  let server: SocketServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  // Feature: Verify SocketServer can start and stop without broadcaster
  // Design: Instantiate SocketServer(host, port) directly, pass if start/stop don't throw
  test("server starts and stops without error", async () => {
    const port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    const addr = await server.start();
    expect(addr).toBe(`127.0.0.1:${String(port)}`);
  });

  // Feature: Verify registered handler correctly processes ping request
  // Design: Start server, send JSON-RPC ping frame via raw TCP, verify pong response format
  test("registered handler processes ping request", async () => {
    const port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    server.register("core.ping", () =>
      Promise.resolve({
        server_version: "0.0.1",
        uptime_ms: 100,
        received_at: new Date().toISOString(),
      }),
    );
    await server.start();

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(port, "127.0.0.1", () => {
        const req = JSON.stringify({
          jsonrpc: "2.0",
          id: "test-1",
          method: "core.ping",
          params: { client: "test" },
        });
        socket.write(req + "\n");
      });
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          resolve(data.trim());
          socket.destroy();
        }
      });
      socket.on("error", reject);
    });

    const resp = parseResponse(response);
    expect(resp["jsonrpc"]).toBe("2.0");
    expect(resp["id"]).toBe("test-1");
    expect(resp["result"]).toBeDefined();
    const result = getResult(resp);
    expect(result["server_version"]).toBe("0.0.1");
  });

  // Feature: Verify METHOD_NOT_FOUND error code (-32601) for unregistered methods
  // Design: Send request for unregistered method, check exact JSON-RPC error code
  test("unknown method returns METHOD_NOT_FOUND", async () => {
    const port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    await server.start();

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(port, "127.0.0.1", () => {
        const req = JSON.stringify({
          jsonrpc: "2.0",
          id: "test-2",
          method: "core.nonexistent",
          params: {},
        });
        socket.write(req + "\n");
      });
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          resolve(data.trim());
          socket.destroy();
        }
      });
      socket.on("error", reject);
    });

    const resp = parseResponse(response);
    expect(resp["error"]).toBeDefined();
    const error = getError(resp);
    expect(error["code"]).toBe(-32601);
  });

  // Feature: Verify PARSE_ERROR (-32700) for non-JSON data without crashing
  // Design: Send raw text instead of JSON, check error code
  test("invalid JSON returns PARSE_ERROR", async () => {
    const port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    await server.start();

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(port, "127.0.0.1", () => {
        socket.write("not valid json\n");
      });
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          resolve(data.trim());
          socket.destroy();
        }
      });
      socket.on("error", reject);
    });

    const resp = parseResponse(response);
    expect(resp["error"]).toBeDefined();
    const error = getError(resp);
    expect(error["code"]).toBe(-32700);
  });

  // Feature: Verify INVALID_PARAMS (-32602) when handler throws ZodError
  // Design: Register handler that uses zod parse, send invalid params, check error code
  test("handler ZodError returns INVALID_PARAMS", async () => {
    const port = await freePort();
    server = new SocketServer("127.0.0.1", port);
    const schema = z.object({ required_field: z.string() });
    server.register("test.validate", (params) => {
      schema.parse(params);
      return Promise.resolve({ ok: true });
    });
    await server.start();

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(port, "127.0.0.1", () => {
        const req = JSON.stringify({
          jsonrpc: "2.0",
          id: "test-4",
          method: "test.validate",
          params: {},
        });
        socket.write(req + "\n");
      });
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          resolve(data.trim());
          socket.destroy();
        }
      });
      socket.on("error", reject);
    });

    const resp = parseResponse(response);
    expect(resp["error"]).toBeDefined();
    const error = getError(resp);
    expect(error["code"]).toBe(-32602);
  });

  // Feature: Verify onDisconnect is invoked exactly once when a client disconnects
  // Design: Pass onDisconnect option, connect and destroy a raw TCP client, await callback
  test("onDisconnect fires once when client disconnects", async () => {
    const port = await freePort();
    const disconnected: net.Socket[] = [];
    let notifyDisconnect: (() => void) | undefined;
    const disconnectSeen = new Promise<void>((resolve) => {
      notifyDisconnect = resolve;
    });
    server = new SocketServer("127.0.0.1", port, {
      onDisconnect: (socket) => {
        disconnected.push(socket);
        notifyDisconnect?.();
      },
    });
    await server.start();

    const client = net.createConnection(port, "127.0.0.1");
    await new Promise<void>((resolve) => client.once("connect", resolve));
    client.destroy();

    await disconnectSeen;
    // Allow any trailing close/error events to settle, then assert single invocation
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(disconnected.length).toBe(1);
    expect(disconnected[0]).toBeInstanceOf(net.Socket);
  });

  // Feature: Verify broadcaster subscriptions are cleaned up on client disconnect
  // Design: Wire onDisconnect -> broadcaster.unsubscribe (as CoreApp does), subscribe via a
  //         handler using getConnectionWriter, disconnect the client, then publish an event
  //         and assert nothing is written to the dead connection socket
  test("client disconnect removes broadcaster subscriptions", async () => {
    const port = await freePort();
    const broadcaster = new IpcEventBroadcaster();

    // Holder object avoids TS control-flow narrowing on closure assignment
    const captured: { socket: net.Socket | null } = { socket: null };
    let notifyDisconnect: (() => void) | undefined;
    const disconnectSeen = new Promise<void>((resolve) => {
      notifyDisconnect = resolve;
    });

    server = new SocketServer("127.0.0.1", port, {
      onDisconnect: (socket) => {
        broadcaster.unsubscribe(socket);
        notifyDisconnect?.();
      },
    });
    server.register("event.subscribe", () => {
      const writer = getConnectionWriter();
      captured.socket = writer;
      const subId = broadcaster.subscribe(writer, ["run.*"], "global");
      return Promise.resolve({ subscription_id: subId, replayed_count: 0 });
    });
    await server.start();

    // Subscribe over a real TCP connection
    const client = net.createConnection(port, "127.0.0.1");
    await new Promise<void>((resolve) => client.once("connect", resolve));
    const gotResponse = new Promise<void>((resolve) => {
      client.once("data", () => {
        resolve();
      });
    });
    client.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "sub-1",
        method: "event.subscribe",
        params: { topics: ["run.*"], scope: "global" },
      }) + "\n",
    );
    await gotResponse;
    expect(captured.socket).not.toBeNull();

    // Disconnect the client and wait for the server-side cleanup callback
    client.destroy();
    await disconnectSeen;

    // Publish an event: the dead socket must not receive anything
    const writes: string[] = [];
    const sock = captured.socket;
    if (!sock) throw new Error("server-side socket not captured");
    sock.write = (chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
    await broadcaster.handle({
      type: "run.started",
      run_id: "r1",
      goal: "test",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(writes.length).toBe(0);
  });

  // Feature (B-3): when the LAST subscribed client disconnects, pending
  // permission requests are cancelled (deny_once) instead of freezing the
  // agent until the permission timeout; with other subscribers remaining
  // the requests stay pending
  // Design: wire onDisconnect exactly as CoreApp does (unsubscribe first,
  // then cancelAll when subscriptionCount() === 0), subscribe two real TCP
  // clients, start a pending checkAndWait, disconnect them one by one
  test("last client disconnect cancels pending permission requests", async () => {
    const port = await freePort();
    const broadcaster = new IpcEventBroadcaster();
    const manager = new PermissionManager({ timeoutS: 30 });

    const disconnectResolvers: (() => void)[] = [];
    const disconnectPromises = [0, 1].map(
      (i) =>
        new Promise<void>((resolve) => {
          disconnectResolvers[i] = resolve;
        }),
    );
    let disconnectCount = 0;

    server = new SocketServer("127.0.0.1", port, {
      // Same wiring as CoreApp.run(): unsubscribe must run first so
      // subscriptionCount() reflects the post-disconnect state
      onDisconnect: (socket) => {
        broadcaster.unsubscribe(socket);
        if (broadcaster.subscriptionCount() === 0) {
          manager.cancelAll("client_disconnected");
        }
        disconnectResolvers[disconnectCount]?.();
        disconnectCount++;
      },
    });
    server.register("event.subscribe", () => {
      const writer = getConnectionWriter();
      const subId = broadcaster.subscribe(writer, ["*"], "global");
      return Promise.resolve({ subscription_id: subId, replayed_count: 0 });
    });
    await server.start();

    // Connect + subscribe a client over real TCP, resolving on the response
    const subscribeClient = async (id: string): Promise<net.Socket> => {
      const client = net.createConnection(port, "127.0.0.1");
      await new Promise<void>((resolve) => client.once("connect", resolve));
      const gotResponse = new Promise<void>((resolve) => {
        client.once("data", () => {
          resolve();
        });
      });
      client.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "event.subscribe",
          params: { topics: ["*"], scope: "global" },
        }) + "\n",
      );
      await gotResponse;
      return client;
    };
    const clientA = await subscribeClient("sub-a");
    const clientB = await subscribeClient("sub-b");
    expect(broadcaster.subscriptionCount()).toBe(2);

    // Start a permission request that stays pending (nobody responds)
    const pending = manager.checkAndWait(
      "tool-use-b3-1",
      "bash",
      { command: "echo hi" },
      "session-1",
      () => Promise.resolve(),
    );

    // First client disconnects: another subscriber remains → still pending
    clientA.destroy();
    await disconnectPromises[0];
    const settledEarly = await Promise.race([
      pending.then(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => {
          resolve(false);
        }, 50),
      ),
    ]);
    expect(settledEarly).toBe(false);

    // Last client disconnects: request is cancelled as deny_once
    clientB.destroy();
    await disconnectPromises[1];
    const [allowed, decision] = await pending;
    expect(allowed).toBe(false);
    expect(decision).toBe("deny_once");
  });
});
