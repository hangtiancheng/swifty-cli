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

// Feature: dual-process integration — spawn the real daemon (tsx src/core/app.ts)
// and exercise core.ping / core.status / event.subscribe over real TCP.
// LLM-dependent RPCs (session.create → createClient) are exercised in the
// manual smoke flow, not here, to keep CI hermetic.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { SocketClient } from "../src/core/socket-client.js";

const HOST = "127.0.0.1";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, HOST, () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      s.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection(port, HOST, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => {
        resolve(false);
      });
    });
    if (ok) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("daemon did not become reachable");
}

describe("dual-process daemon", () => {
  let daemon: ChildProcess;
  let port: number;
  let workDir: string;

  beforeAll(async () => {
    port = await freePort();
    const appRoot = path.resolve(import.meta.dirname, "..");

    // Write a temporary .larky/config.yaml so the daemon picks up the port
    workDir = path.join(
      tmpdir(),
      `larky-dual-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(path.join(workDir, ".larky"), { recursive: true });
    writeFileSync(
      path.join(workDir, ".larky", "config.yaml"),
      `core:\n  port: ${String(port)}\ntrace:\n  enable: false\n`,
    );
    // Symlink node_modules so the daemon can resolve packages
    symlinkSync(path.join(appRoot, "node_modules"), path.join(workDir, "node_modules"));
    // Write a tsconfig that extends the real one with absolute @/ paths
    writeFileSync(
      path.join(workDir, "tsconfig.json"),
      JSON.stringify({
        extends: path.join(appRoot, "tsconfig.json"),
        compilerOptions: { paths: { "@/*": [path.join(appRoot, "src/*")] } },
      }),
    );

    daemon = spawn(process.execPath, ["--import", "tsx", path.join(appRoot, "src/core/app.ts")], {
      cwd: workDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
    await waitForPort(port);
  }, 30_000);

  afterAll(() => {
    daemon.kill("SIGTERM");
    rmSync(workDir, { recursive: true, force: true });
  });

  test("core.ping round-trip", async () => {
    const client = new SocketClient(HOST, port);
    await client.connect();
    try {
      const result = await client.sendCommand("core.ping", { client: "test" });
      expect(typeof result.server_version).toBe("string");
      expect(typeof result.uptime_ms).toBe("number");
    } finally {
      client.close();
    }
  });

  test("core.status reports zero sessions", async () => {
    const client = new SocketClient(HOST, port);
    await client.connect();
    try {
      const result = await client.sendCommand("core.status", {});
      expect(result.active_sessions).toBe(0);
      expect(typeof result.cwd).toBe("string");
    } finally {
      client.close();
    }
  });

  test("event.subscribe returns subscription id", async () => {
    const client = new SocketClient(HOST, port);
    await client.connect();
    try {
      const result = await client.sendCommand("event.subscribe", {
        topics: ["agent.*", "run.*"],
        scope: "global",
        replay_from_run: null,
      });
      expect(String(result.subscription_id)).toMatch(/^sub-/);
      expect(result.replayed_count).toBe(0);
    } finally {
      client.close();
    }
  });

  test("unknown session id returns SESSION_NOT_FOUND", async () => {
    const client = new SocketClient(HOST, port);
    await client.connect();
    try {
      await expect(
        client.sendCommand("run.cancel", { session_id: "sess-nope" }),
      ).rejects.toMatchObject({ code: -32010 });
    } finally {
      client.close();
    }
  });

  test("abrupt client disconnect does not kill the daemon", async () => {
    // Raw socket destroyed mid-connection (regression: readline ECONNRESET crash)
    const raw = net.createConnection(port, HOST);
    await new Promise<void>((resolve) => raw.once("connect", resolve));
    raw.write('{"jsonrpc":"2.0","id":"x","method":"core.ping","params":{"client":"t"}}\n');
    raw.destroy();

    await new Promise((r) => setTimeout(r, 300));

    const client = new SocketClient(HOST, port);
    await client.connect();
    try {
      const result = await client.sendCommand("core.ping", { client: "still-alive" });
      expect(typeof result.server_version).toBe("string");
    } finally {
      client.close();
    }
  });
});
