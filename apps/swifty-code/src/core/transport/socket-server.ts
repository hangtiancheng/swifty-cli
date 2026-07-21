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

// TCP server: read NDJSON lines, dispatch to registered CommandHandler, handle JSON-RPC errors
import { AsyncLocalStorage } from "node:async_hooks";
import net from "node:net";
import { createInterface } from "node:readline";
import { ZodError } from "zod";
import {
  HandlerError,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  JsonRpcRequestSchema,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  makeError,
} from "../bus/envelope.js";
import type { JsonRpcSuccess } from "../bus/envelope.js";
import type { TraceWriter } from "../trace/writer.js";
import { makeCommandTrace, makeErrorTrace, makeResponseTrace } from "../trace/record.js";

export type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

// Per-connection context: the socket currently being processed (for handlers to read connection context)
const writerStorage = new AsyncLocalStorage<net.Socket>();

// Return the Socket for the current handler call's connection
export function getConnectionWriter(): net.Socket {
  const socket = writerStorage.getStore();
  if (!socket) {
    throw new Error("getConnectionWriter() called outside of handler context");
  }
  return socket;
}

const MAX_LINE_BYTES = 64 * 1024 * 1024; // 64 MB per frame

// Return peer address string for trace client_id (matches Python peername)
function peerAddress(socket: net.Socket): string {
  const addr = socket.remoteAddress;
  const port = socket.remotePort;
  if (addr && port) return `${addr}:${String(port)}`;
  return "<unknown>";
}

// Send JSON line to socket and record trace
async function sendJson(socket: net.Socket, data: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const line = JSON.stringify(data) + "\n";
    const ok = socket.write(line, "utf-8", (err) => {
      if (err) reject(err);
      else resolve();
    });
    if (!ok) {
      // Backpressure: wait for drain event
      socket.once("drain", () => {
        resolve();
      });
    }
  });
}

export class SocketServer {
  private _host: string;
  private _port: number;
  private _handlers = new Map<string, CommandHandler>();
  private _server: net.Server | null = null;
  private _activeSockets = new Set<net.Socket>();
  private _trace: TraceWriter | undefined;
  private _onDisconnect: ((socket: net.Socket) => void) | undefined;

  constructor(
    host: string,
    port: number,
    options?: { trace?: TraceWriter; onDisconnect?: (socket: net.Socket) => void },
  ) {
    this._host = host;
    this._port = port;
    this._trace = options?.trace;
    this._onDisconnect = options?.onDisconnect;
  }

  // Register a command handler for a given method name
  register(method: string, handler: CommandHandler): void {
    this._handlers.set(method, handler);
  }

  // Start TCP server; throw error if port is already in use
  async start(): Promise<string> {
    // Probe if port is already in use
    const isOccupied = await this._probePort();
    if (isOccupied) {
      throw new Error(`core already running at ${this._host}:${String(this._port)}`);
    }

    return new Promise<string>((resolve, reject) => {
      this._server = net.createServer((socket) => {
        this._handleConnection(socket);
      });

      this._server.on("error", reject);

      this._server.listen(this._port, this._host, () => {
        resolve(`${this._host}:${String(this._port)}`);
      });
    });
  }

  // Close server: disconnect all active connections first, then close server
  async stop(): Promise<void> {
    const server = this._server;
    if (!server) return;

    for (const socket of this._activeSockets) {
      socket.destroy();
    }
    this._activeSockets.clear();

    return new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
      // 2s timeout for forced shutdown
      setTimeout(() => {
        resolve();
      }, 2000);
    });
  }

  // Probe if port is already in use
  private _probePort(): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = net.createConnection(this._port, this._host, () => {
        probe.destroy();
        resolve(true);
      });
      probe.on("error", () => {
        resolve(false);
      });
    });
  }

  // Handle a single client connection
  private _handleConnection(socket: net.Socket): void {
    this._activeSockets.add(socket);

    // Idempotent per-connection cleanup: remove from active set and notify
    // onDisconnect exactly once so subscribers (e.g. broadcaster) can release
    // any state keyed on this socket.
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      this._activeSockets.delete(socket);
      this._onDisconnect?.(socket);
    };

    const rl = createInterface({
      input: socket,
      terminal: false,
    });

    rl.on("line", (line) => {
      // Enforce per-line size limit (not cumulative): a long-lived connection must
      // be able to send many small commands without being disconnected.
      const lineBytes = Buffer.byteLength(line, "utf-8") + 1;
      if (lineBytes > MAX_LINE_BYTES) {
        void sendJson(socket, makeError(null, INVALID_REQUEST, "Request too large"));
        socket.destroy();
        return;
      }
      // Execute each command independently to avoid blocking the read loop with long-running handlers
      void writerStorage.run(socket, () => this._handleLine(line, socket));
    });

    rl.on("close", () => {
      cleanup();
      socket.destroy();
    });

    socket.on("error", () => {
      cleanup();
      rl.close();
    });
  }

  // Parse a single JSON-RPC request line and call the corresponding handler, write result or error back to client
  private async _handleLine(line: string, socket: net.Socket): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      await sendJson(socket, makeError(null, PARSE_ERROR, `Parse error: ${String(e)}`));
      return;
    }

    const reqResult = JsonRpcRequestSchema.safeParse(parsed);
    if (!reqResult.success) {
      await sendJson(socket, makeError(null, INVALID_REQUEST, "Invalid Request"));
      return;
    }

    const req = reqResult.data;

    // Trace: CLIENT->CORE command
    if (this._trace) {
      this._trace.emit(makeCommandTrace(peerAddress(socket), req.method, req.id, req.params));
    }

    const handler = this._handlers.get(req.method);
    if (!handler) {
      const errorResponse = makeError(req.id, METHOD_NOT_FOUND, `Method not found: ${req.method}`);
      // Trace: CORE->CLIENT error
      if (this._trace) {
        this._trace.emit(makeErrorTrace(peerAddress(socket), req.method, "method_not_found"));
      }
      await sendJson(socket, errorResponse);
      return;
    }

    try {
      const result = await handler(req.params);
      const response: JsonRpcSuccess = {
        jsonrpc: "2.0",
        id: req.id,
        result,
      };
      // Trace: CORE->CLIENT response
      if (this._trace) {
        this._trace.emit(makeResponseTrace(peerAddress(socket), req.method, req.id, result));
      }
      await sendJson(socket, response);
    } catch (e) {
      // Trace: CORE->CLIENT handler error
      if (this._trace) {
        const errMsg = e instanceof Error ? e.message : String(e);
        this._trace.emit(makeErrorTrace(peerAddress(socket), req.method, errMsg));
      }
      if (e instanceof HandlerError) {
        await sendJson(socket, makeError(req.id, e.code, e.message, e.data));
      } else if (e instanceof ZodError) {
        await sendJson(socket, makeError(req.id, INVALID_PARAMS, "Invalid params", e.message));
      } else if (e instanceof Error) {
        console.error(`handler ${req.method} raised:`, e);
        await sendJson(socket, makeError(req.id, INTERNAL_ERROR, "Internal error"));
      }
    }
  }
}
