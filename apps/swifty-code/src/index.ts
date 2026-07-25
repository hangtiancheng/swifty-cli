#!/usr/bin/env node
// Unified entry point for the Swifty CLI.
// Picks the binary matching the current platform/arch from ../build.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLATFORM_MAP: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "darwin",
  linux: "linux",
  android: "linux",
  win32: "windows",
};

const ARCH_MAP: Partial<Record<NodeJS.Architecture, string>> = {
  x64: "x64",
  arm64: "arm64",
};

const { platform, arch } = process;
const platformName = PLATFORM_MAP[platform];
const archName = ARCH_MAP[arch];

if (!platformName || !archName) {
  console.error(`[swifty] Unsupported platform: ${platform} (${arch})`);
  process.exit(1);
}

const ext = platformName === "windows" ? ".exe" : "";
const binaryPath = join(__dirname, "..", "build", `swifty-${platformName}-${archName}${ext}`);

if (!existsSync(binaryPath)) {
  console.error(
    `[swifty] Missing binary: ${binaryPath}\n` +
      "Reinstall: npm install -g @swifty.js/swifty-code@latest",
  );
  process.exit(1);
}

// Asynchronous spawn (instead of spawnSync) so Node can respond to signals
// (e.g. Ctrl-C) while the native binary runs, and forward them to the child.
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

const forwardSignal = (signal: NodeJS.Signals): void => {
  if (child.killed) {
    return;
  }
  try {
    child.kill(signal);
  } catch {
    /* ignore */
  }
};

(["SIGINT", "SIGTERM", "SIGHUP"] as const).forEach((sig) => {
  process.on(sig, () => forwardSignal(sig));
});

type ChildResult = { type: "signal"; signal: NodeJS.Signals } | { type: "code"; exitCode: number };

const childResult = await new Promise<ChildResult>((resolve) => {
  child.on("exit", (code, signal) => {
    if (signal) {
      resolve({ type: "signal", signal });
    } else {
      resolve({ type: "code", exitCode: code ?? 1 });
    }
  });
});

if (childResult.type === "signal") {
  // Re-emit the same signal so the parent exits with 128 + n semantics.
  process.kill(process.pid, childResult.signal);
} else {
  process.exit(childResult.exitCode);
}
