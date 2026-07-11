// Expired log cleanup. Mirrors session.ts cleanExpiredSessions:
// same directory iteration, 30-day mtime check, silent unlinkSync failure.
// Scans .swifty/logs/ and .swifty/teams/<team>/logs/.

import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Log retention days, matches SESSION_EXPIRY_DAYS. */
const LOG_EXPIRY_DAYS = 30;
const LOG_EXPIRY_MS = LOG_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/** Clean expired log files in a single directory. Returns count removed. Failures are silent. */
function cleanDir(dir: string): number {
  if (!existsSync(dir)) {
    return 0;
  }

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return 0;
  }

  const now = Date.now();
  let removed = 0;
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > LOG_EXPIRY_MS) {
        unlinkSync(filePath);
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
export function cleanExpiredLogs(workDir: string): number {
  let removed = 0;
  removed += cleanDir(join(workDir, ".swifty", "logs"));

  const teamsDir = join(workDir, ".swifty", "teams");
  if (!existsSync(teamsDir)) {
    return removed;
  }

  let teams: string[];
  try {
    teams = readdirSync(teamsDir);
  } catch {
    return removed;
  }
  for (const team of teams) {
    removed += cleanDir(join(teamsDir, team, "logs"));
  }
  return removed;
}
