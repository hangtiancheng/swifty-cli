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

// swifty ping command: send ping to core daemon and print pong response
import net from "node:net";
import { performance } from "node:perf_hooks";

import { version } from "../../version.js";
import type { SwiftyConfig } from "../config.js";
import { safeParseAsync } from "zod";
import { JsonRpcErrorObjectSchema, PongResultSchema } from "../bus/index.js";

export interface PingOutcome {
  ok: boolean;
  message?: string;
}

// Ping the core daemon; pure function: never prints, never calls process.exit.
// Returns { ok: true, message } with the formatted pong line on success,
// or { ok: false, message } with an error description on failure.
export async function pingDaemon(config: SwiftyConfig): Promise<PingOutcome> {
  const t0 = performance.now();

  const socket = net.createConnection(config.port, config.host);

  try {
    const connected = await new Promise<boolean>((resolve) => {
      socket.on("connect", () => {
        resolve(true);
      });
      socket.on("error", () => {
        resolve(false);
      });
    });
    if (!connected) {
      return {
        ok: false,
        message: `core not running (${config.host}:${String(config.port)})`,
      };
    }

    const req = {
      jsonrpc: "2.0" as const,
      id: "cli-1",
      method: "core.ping",
      params: { client: `cli/${version}` },
    };

    socket.write(JSON.stringify(req) + "\n", "utf-8");

    const data = await new Promise<Buffer | null>((resolve) => {
      socket.once("data", resolve);
      socket.once("close", () => {
        resolve(null);
      });
    });
    if (data === null) {
      return { ok: false, message: "connection closed before response" };
    }

    const latencyMs = Math.round(performance.now() - t0);

    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return { ok: false, message: "invalid response from core" };
    }
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, message: "invalid response from core" };
    }
    if ("error" in raw) {
      const err = raw.error;
      const { success, data: errData } = await safeParseAsync(JsonRpcErrorObjectSchema, err);
      if (success) {
        return { ok: false, message: `${String(errData.code)} ${errData.message}` };
      }
      return { ok: false, message: "unknown error from core" };
    }

    const result: unknown = "result" in raw ? raw.result : undefined;
    const { data: resData, success } = await safeParseAsync(PongResultSchema, result);
    if (!success) {
      return { ok: false, message: "invalid pong response from core" };
    }
    return {
      ok: true,
      message: `pong server=${resData.server_version} uptime=${String(resData.uptime_ms)}ms latency=${String(latencyMs)}ms`,
    };
  } finally {
    socket.destroy();
  }
}

// Send ping request to core daemon, print pong response with latency
export async function cmdPing(config: SwiftyConfig): Promise<void> {
  const outcome = await pingDaemon(config);
  if (!outcome.ok) {
    console.error(`error: ${outcome.message ?? "ping failed"}`);
    process.exit(1);
  }
  if (outcome.message) {
    console.log(outcome.message);
  }
}
