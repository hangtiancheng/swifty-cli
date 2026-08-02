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

// CLI core command: daemon lifecycle management (start/stop/status)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { LarkyConfig } from "../core/config.js";
import { pingDaemon } from "../core/ping.js";

const PID_FILE = path.join(homedir(), ".larky", "larky-core.pid");

// B-12: guard against PID reuse — before killing, verify the process command
// line looks like our daemon. Uses `ps` (darwin/linux); any failure (ps
// missing, pid gone, unexpected output) counts as no-match. Deliberately does
// NOT match bare "node": after PID reuse that would SIGTERM an unrelated node
// process. The real daemon command always contains "larky" (package/repo dir)
// or the core/app entry path.
function pidLooksLikeLarky(pid: number): boolean {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
    })
      .trim()
      .toLowerCase();
    return out.includes("larky") || /core[/\\]app\.(js|ts)/.test(out);
  } catch {
    return false;
  }
}

function runningPid(): number | null {
  if (!existsSync(PID_FILE)) {
    return null;
  }
  try {
    const raw = readFileSync(PID_FILE, "utf-8").trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid)) {
      unlinkSync(PID_FILE);
      return null;
    }
    // Check if process is alive
    process.kill(pid, 0);
    return pid;
  } catch {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
    return null;
  }
}

// Print daemon status; matches legacy behavior: prints "not running" without
// a non-zero exit code when the daemon is unreachable (informational command).
export async function cmdCoreStatus(config: LarkyConfig): Promise<void> {
  const outcome = await pingDaemon(config);
  if (outcome.ok) {
    console.log(`running  (${config.host}:${String(config.port)})`);
  } else {
    console.log("not running");
  }
}

// Returns the spawned daemon PID, or null when a daemon was already running.
export function cmdCoreStart(config: LarkyConfig, ownerPid?: number): number | null {
  // Check if already running
  const pid = runningPid();
  if (pid) {
    console.log(`already running  pid=${String(pid)}  (${config.host}:${String(config.port)})`);
    return null;
  }

  // Resolve daemon entry point — works in both dev (src/) and dist (bundle).
  // dist layout: dist/cli/main.js  → ../core/app.js  → dist/core/app.js
  // src layout:  src/cli/commands/  → ../../core/app.ts → src/core/app.ts
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distDaemon = path.resolve(__dirname, "../core/app.js");
  const srcDaemon = path.resolve(__dirname, "../../core/app.ts");
  const daemonPath = existsSync(distDaemon) ? distDaemon : srcDaemon;
  // LARKY_OWNER_PID lets the daemon self-terminate if the owning process dies
  // without running cleanup handlers (kill -9, segfault, OOM). Strip any
  // inherited value when no owner is given (manual `larky core start`), so
  // the daemon never watches an unrelated PID from the caller's environment.
  const env = { ...process.env };
  if (ownerPid === undefined) {
    delete env.LARKY_OWNER_PID;
  } else {
    env.LARKY_OWNER_PID = String(ownerPid);
  }
  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();

  // Write PID file
  const dir = path.dirname(PID_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(PID_FILE, String(child.pid), "utf-8");

  console.log(`started  pid=${String(child.pid)}  (${config.host}:${String(config.port)})`);
  return child.pid ?? null;
}

// Start the daemon if it is not reachable, then wait until it answers ping.
// Returns the spawned daemon PID if this process spawned it, null if a daemon
// was already running.
export async function ensureDaemonRunning(config: LarkyConfig): Promise<number | null> {
  const outcome = await pingDaemon(config);
  if (outcome.ok) {
    return null;
  }

  const spawnedPid = cmdCoreStart(config, process.pid);

  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const retry = await pingDaemon(config);
    if (retry.ok) {
      return spawnedPid;
    }
  }

  console.error(`Error: daemon did not become reachable at ${config.host}:${String(config.port)}`);
  // Clean up the daemon we just spawned so it is not left orphaned
  if (spawnedPid !== null) {
    stopSpawnedDaemon(spawnedPid);
  }
  process.exit(1);
}

// SIGTERM exactly the daemon we spawned (never the PID-file one: by exit time
// the file may point at a daemon the user manually restarted). Removes the
// PID file only when it still refers to that same process.
function stopSpawnedDaemon(spawnedPid: number): void {
  try {
    process.kill(spawnedPid, 0);
  } catch {
    return; // already gone
  }
  if (!pidLooksLikeLarky(spawnedPid)) {
    return; // PID reused by an unrelated process — do not kill
  }
  try {
    process.kill(spawnedPid, "SIGTERM");
  } catch {
    return;
  }
  try {
    if (existsSync(PID_FILE) && Number(readFileSync(PID_FILE, "utf-8").trim()) === spawnedPid) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // best effort
  }
}

// Gracefully stop the daemon we spawned when this process terminates for any
// reason: normal exit, termination signals, or crashes (uncaught
// exception/rejection). Only ever kills the exact PID we spawned, so a daemon
// the user started (or restarted) manually is left untouched.
export function stopDaemonOnExit(_config: LarkyConfig, spawnedPid: number): void {
  let done = false;
  const stopOnce = (): void => {
    if (done) {
      return;
    }
    done = true;
    try {
      stopSpawnedDaemon(spawnedPid);
    } catch {
      // best effort: never let cleanup itself throw during shutdown
    }
  };

  process.on("exit", stopOnce);

  const signals: { name: NodeJS.Signals; code: number }[] = [
    { name: "SIGINT", code: 130 },
    { name: "SIGTERM", code: 143 },
    { name: "SIGHUP", code: 129 },
  ];
  for (const { name, code } of signals) {
    process.on(name, () => {
      stopOnce();
      process.exit(code);
    });
  }

  process.on("uncaughtException", (error) => {
    console.error(error);
    stopOnce();
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(reason);
    stopOnce();
    process.exit(1);
  });
}

export function cmdCoreStop(_config: LarkyConfig): void {
  const pid = runningPid();
  if (!pid) {
    console.log("not running");
    return;
  }

  // B-12: PID files can go stale and the OS may reuse the PID for an
  // unrelated process — never kill a process that doesn't look like ours.
  if (!pidLooksLikeLarky(pid)) {
    console.warn(
      `warning: pid=${String(pid)} does not look like larky-core (PID reuse?); removing stale PID file without killing`,
    );
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
    return;
  }

  process.kill(pid, "SIGTERM");
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }
  console.log(`stopped  pid=${String(pid)}`);
}
