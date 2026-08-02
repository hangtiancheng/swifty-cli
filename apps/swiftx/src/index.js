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

// @ts-check

// Unified entry point for the Swiftx CLI.
// Picks the binary matching the current platform/arch from ../build.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Map of Node.js platform names to binary file name segments.
 *
 * @type {Partial<Record<NodeJS.Platform, string>>}
 */
const PLATFORM_MAP = {
  darwin: "darwin",
  linux: "linux",
  android: "linux",
  win32: "windows",
};

/**
 * Map of Node.js architecture names to binary file name segments.
 *
 * @type {Partial<Record<NodeJS.Architecture, string>>}
 */
const ARCH_MAP = {
  x64: "x64",
  arm64: "arm64",
};

const { platform, arch } = process;
const platformName = PLATFORM_MAP[platform];
const archName = ARCH_MAP[arch];

if (!platformName || !archName) {
  console.error(`[swiftx] Unsupported platform: ${platform} (${arch})`);
  process.exit(1);
}

const ext = platformName === "windows" ? ".exe" : "";
const binaryPath = join(
  __dirname,
  "..",
  "build",
  `swiftx-${platformName}-${archName}${ext}`,
);

if (!existsSync(binaryPath)) {
  console.error(
    `[swiftx] Missing binary: ${binaryPath}\n` +
      "Run: node " +
      join(__dirname, "..", "install.mjs") +
      "\n" +
      "Or reinstall: npm install -g @swifty.js/swiftx@latest",
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

/**
 * Forward a received signal to the child process, ignoring failures from an
 * already-exited child.
 *
 * @param {NodeJS.Signals} signal - The signal to forward.
 * @returns {void}
 */
const forwardSignal = (signal) => {
  if (child.killed) {
    return;
  }
  try {
    child.kill(signal);
  } catch {
    /* ignore */
  }
};

/** @type {readonly NodeJS.Signals[]} */
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

FORWARDED_SIGNALS.forEach((sig) => {
  process.on(sig, () => forwardSignal(sig));
});

/**
 * How the child process terminated: killed by a signal, or exited with a code.
 *
 * @typedef {{ type: "signal", signal: NodeJS.Signals } | { type: "code", exitCode: number }} ChildResult
 */

const childResult = await /** @type {Promise<ChildResult>} */ (
  new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve({ type: "signal", signal });
      } else {
        resolve({ type: "code", exitCode: code ?? 1 });
      }
    });
  })
);

if (childResult.type === "signal") {
  // Re-emit the same signal so the parent exits with 128 + n semantics.
  process.kill(process.pid, childResult.signal);
} else {
  process.exit(childResult.exitCode);
}
