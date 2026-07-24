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

// TCP client: connect to core daemon, send commands and receive events
import net from "node:net";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

import type { JsonRpcRequest } from "../bus/envelope.js";
import { isRecord } from "../bus/envelope.js";

export type EventHandler = (event: Record<string, unknown>) => Promise<void>;

// IPC error: JSON-RPC error response
export class IpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`[${String(code)}] ${message}`);
    this.name = "IpcError";
    this.code = code;
  }
}

export class SocketClient {
  private _host: string;
  private _port: number;
  private _socket: net.Socket | null = null;
  private _pending = new Map<
    string,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >();
  private _eventHandlers: EventHandler[] = [];
  private _disconnectResolvers: (() => void)[] = [];

  constructor(host: string, port: number) {
    this._host = host;
    this._port = port;
  }

  // Establish TCP connection to core daemon and start reading messages
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._socket = net.createConnection(this._port, this._host, () => {
        this._startReading();
        resolve();
      });
      this._socket.on("error", (err) => {
        reject(err);
        // Also signal disconnect for waitForDisconnect() callers
        this._signalDisconnect();
      });
    });
  }

  // Returns a promise that resolves when the connection drops
  // Used by the auto-reconnect loop to detect mid-session disconnections
  // Supports multiple concurrent waiters (e.g. runEventLoop + Promise.race guards)
  waitForDisconnect(): Promise<void> {
    // If socket is already null or destroyed, resolve immediately
    if (!this._socket || this._socket.destroyed) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this._disconnectResolvers.push(resolve);
    });
  }

  // Block until the connection drops (used by CLI commands to keep processing events)
  // Equivalent to waitForDisconnect() — _startReading() already handles message dispatch
  async runEventLoop(): Promise<void> {
    return this.waitForDisconnect();
  }

  // Signal that the connection has been lost
  private _signalDisconnect(): void {
    const resolvers = this._disconnectResolvers;
    this._disconnectResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }

  // Start reading lines from the socket and dispatching responses/events
  private _startReading(): void {
    if (!this._socket) return;

    const rl = createInterface({
      input: this._socket,
      terminal: false,
    });

    rl.on("line", (line) => {
      void this._dispatch(line);
    });

    rl.on("close", () => {
      for (const [, pending] of this._pending) {
        pending.reject(new Error("connection closed"));
      }
      this._pending.clear();
      this._signalDisconnect();
    });
  }

  // Close TCP connection and reset internal state for reconnection
  close(): void {
    // Reject all pending commands before clearing, matching rl.on("close") behavior.
    // This ensures pending sendCommand() promises settle even if the readline "close"
    // event never fires (e.g., socket already destroyed externally).
    for (const [, pending] of this._pending) {
      pending.reject(new Error("connection closed"));
    }
    this._pending.clear();
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
    // Resolve any waitForDisconnect() waiters deterministically
    this._signalDisconnect();
  }

  // Register callback for server-pushed events (persists across reconnections)
  onEvent(handler: EventHandler): void {
    this._eventHandlers.push(handler);
  }

  // Send JSON-RPC command and wait for response
  async sendCommand(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this._socket) {
      throw new Error("not connected - call connect() first");
    }

    const reqId = randomUUID();
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: reqId,
      method,
      params,
    };

    const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
    this._pending.set(reqId, { resolve, reject });

    this._socket.write(JSON.stringify(request) + "\n", "utf-8");
    return promise;
  }

  // Parse a single message line and route to pending promise or event handler
  private async _dispatch(line: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) return;
      msg = parsed;
    } catch {
      return;
    }

    if ("jsonrpc" in msg) {
      const reqIdRaw = msg["id"];
      const reqId = typeof reqIdRaw === "string" ? reqIdRaw : undefined;
      if (reqId && this._pending.has(reqId)) {
        const pending = this._pending.get(reqId);
        if (!pending) return;
        this._pending.delete(reqId);
        if ("error" in msg) {
          const errRaw = msg["error"];
          const errObj = typeof errRaw === "object" && errRaw !== null ? errRaw : null;
          const errCode = errObj && "code" in errObj ? errObj.code : undefined;
          const errMsg = errObj && "message" in errObj ? errObj.message : undefined;
          pending.reject(
            new IpcError(
              typeof errCode === "number" ? errCode : -1,
              typeof errMsg === "string" ? errMsg : "unknown",
            ),
          );
        } else {
          const result = msg["result"];
          pending.resolve(isRecord(result) ? result : {});
        }
      }
    } else if (msg["kind"] === "event") {
      const eventData = msg["event"];
      if (isRecord(eventData)) {
        for (const handler of this._eventHandlers) {
          await handler(eventData);
        }
      }
    }
  }
}
