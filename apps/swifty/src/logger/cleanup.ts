// Expired log cleanup. Mirrors session.ts cleanExpiredSessions:
// same directory iteration, 30-day mtime check, silent unlink failure.
// Scans .swifty/logs/ and .swifty/teams/<team>/logs/.
// All fs operations are async to avoid blocking the event loop.

import { readdir, stat, unlink, access } from "node:fs/promises";
import { join } from "node:path";

/** Log retention days, matches SESSION_EXPIRY_DAYS. */
const LOG_EXPIRY_DAYS = 30;
const LOG_EXPIRY_MS = LOG_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/** Check whether a path is accessible. Returns false on any error. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Clean expired log files in a single directory. Returns count removed. Failures are silent. */
async function cleanDir(dir: string): Promise<number> {
  if (!(await pathExists(dir))) {
    return 0;
  }

  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return 0;
  }

  const now = Date.now();
  let removed = 0;
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const s = await stat(filePath);
      if (now - s.mtimeMs > LOG_EXPIRY_MS) {
        await unlink(filePath);
        removed++;
      }
    } catch {
      // Silently skip
    }
  }
  return removed;
}

/**
 * Clean expired logs. Scans the default .swifty/logs/ and all team-specific
 * .swifty/teams/<team>/logs/ directories. Only called by the main process
 * (teammate subprocesses skip via skipCleanup).
 */
export async function cleanExpiredLogs(workDir: string): Promise<number> {
  let removed = 0;
  removed += await cleanDir(join(workDir, ".swifty", "logs"));

  const teamsDir = join(workDir, ".swifty", "teams");
  if (!(await pathExists(teamsDir))) {
    return removed;
  }

  let teams: string[];
  try {
    teams = await readdir(teamsDir);
  } catch {
    return removed;
  }
  for (const team of teams) {
    removed += await cleanDir(join(teamsDir, team, "logs"));
  }
  return removed;
}
