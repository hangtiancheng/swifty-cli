#!/usr/bin/env node
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
      "Reinstall: npm install -g @swifty.js/swiftx@latest",
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
