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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { SwiftyConfig } from "../../core/config.js";
import { pingDaemon } from "../../core/commands/ping.js";

const PID_FILE = path.join(homedir(), ".swifty-code", "swifty-core.pid");

// B-12: guard against PID reuse — before killing, verify the process command
// line looks like our daemon ("swifty" or "node"). Uses `ps` (darwin/linux);
// any failure (ps missing, pid gone, unexpected output) counts as no-match.
function pidLooksLikeSwifty(pid: number): boolean {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
    })
      .trim()
      .toLowerCase();
    return out.includes("swifty") || out.includes("node");
  } catch {
    return false;
  }
}

function runningPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
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
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    return null;
  }
}

// Print daemon status; matches legacy behavior: prints "not running" without
// a non-zero exit code when the daemon is unreachable (informational command).
export async function cmdCoreStatus(config: SwiftyConfig): Promise<void> {
  const outcome = await pingDaemon(config);
  if (outcome.ok) {
    console.log(`running  (${config.host}:${String(config.port)})`);
  } else {
    console.log("not running");
  }
}

export function cmdCoreStart(config: SwiftyConfig): void {
  // Check if already running
  const pid = runningPid();
  if (pid) {
    console.log(
      `already running  pid=${String(pid)}  (${config.host}:${String(config.port)})`,
    );
    return;
  }

  // Resolve daemon entry point — works in both dev (src/) and dist (bundle).
  // dist layout: dist/cli/main.js  → ../core/app.js  → dist/core/app.js
  // src layout:  src/cli/commands/  → ../../core/app.ts → src/core/app.ts
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distDaemon = path.resolve(__dirname, "../core/app.js");
  const srcDaemon = path.resolve(__dirname, "../../core/app.ts");
  const daemonPath = existsSync(distDaemon) ? distDaemon : srcDaemon;
  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Write PID file
  const dir = path.dirname(PID_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PID_FILE, String(child.pid), "utf-8");

  console.log(
    `started  pid=${String(child.pid)}  (${config.host}:${String(config.port)})`,
  );
}

export function cmdCoreStop(_config: SwiftyConfig): void {
  const pid = runningPid();
  if (!pid) {
    console.log("not running");
    return;
  }

  // B-12: PID files can go stale and the OS may reuse the PID for an
  // unrelated process — never kill a process that doesn't look like ours.
  if (!pidLooksLikeSwifty(pid)) {
    console.warn(
      `warning: pid=${String(pid)} does not look like swifty-core (PID reuse?); removing stale PID file without killing`,
    );
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    return;
  }

  process.kill(pid, "SIGTERM");
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  console.log(`stopped  pid=${String(pid)}`);
}
