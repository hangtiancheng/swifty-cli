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
