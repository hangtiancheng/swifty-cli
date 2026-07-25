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

import { spawnSync } from "node:child_process";
import { existsSync, statSync, rmSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const swiftyGoDir = resolve(__dirname, "../../../swifty.go");
const swiftyCliDir = join(swiftyGoDir, "swiftx");
const buildSrcDir = join(swiftyCliDir, "build");
const buildDestDir = join(__dirname, "build");

/**
 *
 * @param {string} message
 */
function fail(message) {
  console.error(`[swiftx] ${message}`);
  process.exit(1);
}

/**
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 */
function run(command, args, cwd) {
  console.log(`[swiftx] $ ${command} ${args.join(" ")} (cwd: ${cwd})`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    fail(`failed to run "${command}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`"${command} ${args.join(" ")}" exited with code ${result.status}`);
  }
}

if (!existsSync(swiftyGoDir) || !statSync(swiftyGoDir).isDirectory()) {
  fail(`swifty.go directory not found: ${swiftyGoDir}`);
}

if (!existsSync(join(swiftyGoDir, "go.work"))) {
  fail(`swifty.go is not a go work monorepo (missing go.work): ${swiftyGoDir}`);
}

run("go", ["work", "sync"], swiftyGoDir);

if (!existsSync(swiftyCliDir) || !statSync(swiftyCliDir).isDirectory()) {
  fail(`swifty_cli directory not found: ${swiftyCliDir}`);
}

run("go", ["mod", "tidy"], swiftyCliDir);
run("node", ["./build.mjs"], swiftyCliDir);

if (!existsSync(buildSrcDir) || !statSync(buildSrcDir).isDirectory()) {
  fail(`build output not found: ${buildSrcDir}`);
}

try {
  rmSync(buildDestDir, { recursive: true, force: true });
  cpSync(buildSrcDir, buildDestDir, { recursive: true });
} catch (err) {
  fail(`failed to copy build output: ${err instanceof Error ? err.message : String(err)}`);
}

console.log(`[swiftx] build copied to ${buildDestDir}`);
