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

// Dev launcher: spawns daemon in background, then runs TUI in foreground terminal
import { fork } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";

import { getConfig } from "./core/config.js";
import { launchTUI } from "./tui/index.js";

// Wait for daemon to be ready: poll TCP connection, then verify the JSON-RPC
// protocol is actually up with a core.ping round-trip (a listening socket
// alone does not mean the daemon can serve requests yet).
function waitForDaemon(host: string, port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise<void>((resolve, reject) => {
    const tryConnect = (): void => {
      if (Date.now() > deadline) {
        reject(new Error(`daemon not ready after ${String(timeoutMs)}ms`));
        return;
      }
      let settled = false;
      const sock = createConnection({ host, port }, () => {
        // TCP is up; now confirm protocol readiness with core.ping
        let buffer = "";
        sock.setEncoding("utf-8");
        sock.on("data", (chunk: string) => {
          buffer += chunk;
          const newlineIdx = buffer.indexOf("\n");
          if (newlineIdx < 0) {
            return;
          }
          const line = buffer.slice(0, newlineIdx);
          settled = true;
          sock.destroy();
          try {
            const msg: unknown = JSON.parse(line);
            if (typeof msg === "object" && msg !== null && "id" in msg && msg.id === "dev-ping") {
              resolve();
              return;
            }
          } catch {
            // fall through to retry
          }
          setTimeout(tryConnect, 200);
        });
        sock.write(
          '{"jsonrpc":"2.0","id":"dev-ping","method":"core.ping","params":{"client":"dev"}}\n',
          "utf-8",
        );
      });
      sock.on("error", () => {
        if (settled) return;
        settled = true;
        sock.destroy();
        setTimeout(tryConnect, 200);
      });
    };
    tryConnect();
  });
}

async function main(): Promise<void> {
  const config = getConfig();

  // Check if daemon is already running
  const isDaemonRunning = await isPortInUse(config.host, config.port);

  let daemon: ReturnType<typeof fork> | null = null;

  if (isDaemonRunning) {
    console.log(`[dev] daemon already running at ${config.host}:${String(config.port)}`);
  } else {
    // Spawn daemon as a detached background process
    const daemonPath = path.resolve("src/core/app.ts");
    daemon = fork(daemonPath, [], {
      detached: true, // Detach so it survives parent exit
      // Inherit stderr so daemon startup errors are visible during dev
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      execArgv: ["--import", "tsx"],
    });

    daemon.unref();

    try {
      await waitForDaemon(config.host, config.port);
      console.log(`[dev] daemon ready at ${config.host}:${String(config.port)}`);
    } catch (err) {
      console.error("[dev] daemon failed to start:", String(err));
      daemon.kill("SIGTERM");
      process.exit(1);
    }
  }

  // Run TUI in foreground (has raw mode access to terminal)
  let exitCode = 0;

  // Cleanup helper: kill daemon if we started it
  const killDaemon = (): void => {
    if (!daemon) return;
    daemon.kill("SIGTERM");
    // Force kill after 3s if SIGTERM doesn't work
    const timer = setTimeout(() => {
      daemon.kill("SIGKILL");
    }, 3000);
    daemon.on("exit", () => {
      clearTimeout(timer);
    });
  };

  // Handle Ctrl+C and SIGTERM: kill daemon before exiting
  const onSignal = (): void => {
    killDaemon();
    process.exit(1);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);

  try {
    await launchTUI();
  } catch (err) {
    console.error("[dev] TUI error:", String(err));
    exitCode = 1;
  }

  // Cleanup: kill daemon on TUI exit (only if we started it)
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  process.off("SIGHUP", onSignal);
  if (daemon) {
    daemon.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        daemon.kill("SIGKILL");
        resolve();
      }, 3000);
      daemon.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  process.exit(exitCode);
}

// Check if a port is already in use
function isPortInUse(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => {
      resolve(false);
    });
  });
}

void main();
