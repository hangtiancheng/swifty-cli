// CLI core command: daemon lifecycle management (start/stop/status)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { SwiftyConfig } from "../../core/config.js";
import { cmdPing } from "../../core/commands/ping.js";

const PID_FILE = path.join(homedir(), ".swifty", "swifty-core.pid");

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

export async function cmdCoreStatus(config: SwiftyConfig): Promise<void> {
  try {
    await cmdPing(config);
    console.log(`running  (${config.host}:${String(config.port)})`);
  } catch {
    console.log("not running");
  }
}

export function cmdCoreStart(config: SwiftyConfig): void {
  // Check if already running
  const pid = runningPid();
  if (pid) {
    console.log(`already running  pid=${String(pid)}  (${config.host}:${String(config.port)})`);
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

  console.log(`started  pid=${String(child.pid)}  (${config.host}:${String(config.port)})`);
}

export function cmdCoreStop(_config: SwiftyConfig): void {
  const pid = runningPid();
  if (!pid) {
    console.log("not running");
    return;
  }

  process.kill(pid, "SIGTERM");
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  console.log(`stopped  pid=${String(pid)}`);
}
