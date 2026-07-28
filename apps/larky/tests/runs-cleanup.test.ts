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

/** P2-17: startup cleanup of stale run replay dirs. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, afterEach } from "vitest";

import { cleanExpiredRunDirs } from "../src/core/app.js";

describe("cleanExpiredRunDirs", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  function makeWorkDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "larky-runs-clean-"));
    dirs.push(dir);
    return dir;
  }

  function makeRunDir(workDir: string, name: string, ageMs: number): string {
    const p = join(workDir, ".larky", "daemon", "runs", name);
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, "events.jsonl"), "{}\n");
    const t = (Date.now() - ageMs) / 1000;
    utimesSync(p, t, t);
    return p;
  }

  it("returns 0 when the runs dir does not exist", async () => {
    expect(await cleanExpiredRunDirs(makeWorkDir())).toBe(0);
  });

  it("removes only dirs that are both old and beyond the keep window", async () => {
    const workDir = makeWorkDir();
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    // 25 old dirs: the 20 most recent are kept regardless of age.
    for (let i = 0; i < 25; i++) {
      makeRunDir(workDir, `run-old-${String(i).padStart(2, "0")}`, eightDays + i * 1000);
    }
    // A fresh dir is never removed even if beyond the keep window.
    makeRunDir(workDir, "run-fresh", 1000);

    const removed = await cleanExpiredRunDirs(workDir);
    // 26 dirs total, keep the 20 newest; the 6 oldest are all >7d → removed.
    expect(removed).toBe(6);
  });

  it("keeps young dirs beyond the keep window", async () => {
    const workDir = makeWorkDir();
    for (let i = 0; i < 25; i++) {
      makeRunDir(workDir, `run-young-${String(i).padStart(2, "0")}`, i * 1000);
    }
    expect(await cleanExpiredRunDirs(workDir)).toBe(0);
  });
});
