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

// Force-kill all swifty-code related processes
// Usage: node kill.mjs
import { execSync } from "node:child_process";

const TARGETS = [
  { pattern: "swifty-code/src/core/app.ts", label: "daemon" },
  { pattern: "swifty-code/src/dev.ts", label: "dev.ts" },
  { pattern: "swifty-code/src/tui/bootstrap.ts", label: "tui" },
];

let killed = 0;

for (const { pattern, label } of TARGETS) {
  try {
    const pids = execSync(`pgrep -f "${pattern}"`, { encoding: "utf-8" }).trim();
    if (!pids) continue;
    const pidList = pids.split("\n");
    console.log(`[kill] found ${pidList.length} ${label} process(es): ${pidList.join(", ")}`);
    execSync(`kill -TERM ${pids}`);
    killed += pidList.length;
  } catch {
    // pgrep no match or kill failed — both fine
  }
}

if (killed === 0) {
  console.log("[kill] no swifty-code processes found");
  process.exit(0);
}

// Wait 1s then check for survivors
await new Promise((r) => setTimeout(r, 1000));

for (const { pattern, label } of TARGETS) {
  try {
    const pids = execSync(`pgrep -f "${pattern}"`, { encoding: "utf-8" }).trim();
    if (!pids) continue;
    console.log(`[kill] ${label} still alive (${pids.replace(/\n/g, ", ")}), sending SIGKILL`);
    execSync(`kill -KILL ${pids}`);
  } catch {
    // No survivors
  }
}

// Also free port 7437 if anything is still holding it
try {
  const portPids = execSync("lsof -ti :7437", { encoding: "utf-8" }).trim();
  if (portPids) {
    console.log(`[kill] port 7437 still held by: ${portPids.replace(/\n/g, ", ")}, SIGKILL`);
    execSync(`kill -KILL ${portPids}`);
  }
} catch {
  // Port already free
}

console.log("[kill] done");
