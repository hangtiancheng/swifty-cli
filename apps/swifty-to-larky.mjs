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

/**
 * swifty-to-larky.mjs — Migration sync script that copies business code from
 * apps/swifty into apps/larky, applying brand renaming on the fly.
 *
 * Usage (from anywhere in the repository):
 *   node apps/swifty-to-larky.mjs           # default dry-run: print planned operations only
 *   node apps/swifty-to-larky.mjs --write   # actually write files to disk
 *
 * Behavior contract (see apps/migrate.md):
 *   - Scope: the 28 business module directories under swifty/src plus
 *     print-mode.ts/teammate.ts, and swifty/tests (*.test.ts + run-e2e.mjs +
 *     run-failing.mjs). main.tsx is NOT copied — it has been fully superseded
 *     by cli/main.ts + tui/index.tsx in larky.
 *   - Brand renaming (text files only): swifty→larky, Swifty→Larky,
 *     SWIFTY→LARKY, then the collaterally renamed package scope @larky.js is
 *     reverted to @swifty.js (workspace package names must stay real).
 *   - Files already reworked for larky's dual-process architecture (the
 *     PROTECTED list) are NEVER overwritten; they are listed explicitly at the
 *     end. There is deliberately no force-overwrite flag.
 *   - Everything else is overwritten: new files are tagged "new", overwrites
 *     "update", and files whose transformed content already matches "same".
 *   - node_modules/dist/.DS_Store are excluded during recursive copy
 *     (remote/fe/dist is a build artifact — users rebuild it via fe:build).
 *   - A final report lists every file under apps/swifty that was NOT
 *     migrated; a directory with no migrated file at all is collapsed to a
 *     single "<dir>/*" line.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SWIFTY = path.join(APPS_DIR, "swifty");
const LARKY = path.join(APPS_DIR, "larky");

// Safe default: without --write the script always runs as a dry-run.
const DRY_RUN = !process.argv.includes("--write");

// The 28 business module directories (matches migrate.md §2.3).
const SRC_DIRS = [
  "agent", "llm", "conversation", "tools", "tool-result", "prompt",
  "permissions", "sandbox", "config", "session", "compact", "memory",
  "skills", "commands", "subagent", "teams", "hooks", "mcp", "worktree",
  "code-review", "file-history", "plan-file", "todo", "history", "logger",
  "utils", "tui", "remote",
];

// Top-level single files. main.tsx is intentionally excluded: it has been
// replaced by cli/main.ts + tui/index.tsx and would break typecheck.
const SRC_FILES = ["print-mode.ts", "teammate.ts"];

// Files already reworked for larky's dual-process architecture — never
// overwritten (paths relative to the larky root).
const PROTECTED = new Set([
  "src/tui/app.tsx",   // rewritten as the SocketClient event-driven TUI
  "src/tui/index.tsx", // launchTUI: alt-screen + SocketClient wiring
  "src/teams/team.ts", // teammate external-backend entry redirected to cli/main
]);

// Directory/file names skipped during recursive copy. "dist" covers the
// remote/fe build output, which users regenerate with `pnpm fe:build`.
const IGNORE = new Set(["node_modules", "dist", ".DS_Store"]);

// Brand renaming applies to text files only; everything else (wasm, images,
// native binaries) is copied byte-for-byte.
const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".json", ".md", ".yml",
  ".yaml", ".html", ".css", ".txt", ".toml",
]);

/**
 * Brand renaming: swifty→larky / Swifty→Larky / SWIFTY→LARKY, then revert the
 * workspace package scope @larky.js back to @swifty.js so imports keep
 * pointing at packages that actually exist.
 * Covered examples: the .swifty config dir → .larky, __SWIFTY_VERSION__ →
 * __LARKY_VERSION__, SWIFTY_BYPASS_PERMISSIONS → LARKY_BYPASS_PERMISSIONS,
 * "You are Swifty" → "You are Larky".
 */
function brandTransform(content) {
  return content
    .replaceAll("swifty", "larky")
    .replaceAll("Swifty", "Larky")
    .replaceAll("SWIFTY", "LARKY")
    .replaceAll("@larky.js", "@swifty.js")
    .replaceAll("@larky\\.js", "@swifty\\.js"); // escaped form inside regex literals
}

const stats = { new: 0, update: 0, same: 0 };
const skippedProtected = [];
const missingSources = [];
// Every swifty-relative path that was migrated ("new"/"update"/"same" all
// count); used at the end to compute the not-migrated report.
const migrated = new Set();

/** Reads a source file, applying brand renaming when applicable; returns a Buffer. */
function transformedContent(src) {
  const raw = readFileSync(src);
  if (!TEXT_EXTS.has(path.extname(src))) return raw;
  return Buffer.from(brandTransform(raw.toString("utf-8")), "utf-8");
}

/** Copies a single file, honoring the PROTECTED list, brand renaming, dry-run, and stats. */
function copyFile(src, dest) {
  const relDest = path.relative(LARKY, dest);
  if (PROTECTED.has(relDest)) {
    skippedProtected.push(relDest);
    return;
  }
  migrated.add(path.relative(SWIFTY, src));
  const content = transformedContent(src);
  const exists = existsSync(dest);
  if (exists) {
    try {
      if (readFileSync(dest).equals(content)) {
        stats.same++;
        return;
      }
    } catch {
      // Unreadable destination: treat as needing an overwrite.
    }
  }
  const kind = exists ? "update" : "new";
  stats[kind]++;
  console.log(`  [${kind.padEnd(6)}] ${relDest}`);
  if (!DRY_RUN) {
    mkdirSync(path.dirname(dest), { recursive: true });
    if (TEXT_EXTS.has(path.extname(src))) {
      writeFileSync(dest, content);
    } else {
      copyFileSync(src, dest); // binary: byte-for-byte copy
    }
  }
}

/** Recursively copies a directory tree. */
function copyDir(srcDir, destDir) {
  for (const entry of readdirSync(srcDir)) {
    if (IGNORE.has(entry)) continue;
    const src = path.join(srcDir, entry);
    const dest = path.join(destDir, entry);
    if (statSync(src).isDirectory()) {
      copyDir(src, dest);
    } else {
      copyFile(src, dest);
    }
  }
}

// Directories that by definition never contain migrated files — collapsed to
// "<dir>/*" without walking them (node_modules can hold tens of thousands of
// entries).
const ALWAYS_COLLAPSE = new Set(["node_modules", ".git"]);

/**
 * Walks the swifty tree and collects every file that was NOT migrated.
 * A directory whose entire subtree contains no migrated file is collapsed to
 * a single "<dir>/*" line instead of listing each file.
 * Returns [subtreeHasMigratedFile, subtreeHasAnyFile].
 */
function collectUnmigrated(absDir, relDir, out) {
  let hasMigrated = false;
  let hasAnyFile = false;
  const pending = [];
  for (const entry of readdirSync(absDir)) {
    const abs = path.join(absDir, entry);
    const rel = relDir ? `${relDir}/${entry}` : entry;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; // broken symlink etc.
    }
    if (st.isDirectory()) {
      if (ALWAYS_COLLAPSE.has(entry)) {
        hasAnyFile = true;
        pending.push(`${rel}/*`);
        continue;
      }
      const sub = [];
      const [subMigrated, subAnyFile] = collectUnmigrated(abs, rel, sub);
      if (!subAnyFile) continue; // empty subtree: nothing to report
      hasAnyFile = true;
      if (subMigrated) {
        hasMigrated = true;
        pending.push(...sub); // partially migrated: list individual leftovers
      } else {
        pending.push(`${rel}/*`); // fully unmigrated: collapse
      }
    } else {
      hasAnyFile = true;
      if (migrated.has(rel)) {
        hasMigrated = true;
      } else {
        pending.push(PROTECTED.has(rel) ? `${rel} (protected)` : rel);
      }
    }
  }
  out.push(...pending);
  return [hasMigrated, hasAnyFile];
}

function main() {
  if (!existsSync(SWIFTY) || !existsSync(LARKY)) {
    console.error(`error: both ${SWIFTY} and ${LARKY} must exist`);
    process.exit(1);
  }
  console.log(
    `swifty → larky copy + brand renaming${DRY_RUN ? " (dry-run, no writes; pass --write to apply)" : ""}\n`,
  );

  // 1. src business module directories
  console.log("== src business modules ==");
  for (const dir of SRC_DIRS) {
    const src = path.join(SWIFTY, "src", dir);
    if (!existsSync(src)) {
      missingSources.push(`src/${dir}`);
      continue;
    }
    copyDir(src, path.join(LARKY, "src", dir));
  }

  // 2. src top-level single files
  for (const file of SRC_FILES) {
    const src = path.join(SWIFTY, "src", file);
    if (!existsSync(src)) {
      missingSources.push(`src/${file}`);
      continue;
    }
    copyFile(src, path.join(LARKY, "src", file));
  }

  // 3. tests: *.test.ts + run-e2e.mjs + run-failing.mjs
  console.log("\n== tests ==");
  const testsDir = path.join(SWIFTY, "tests");
  for (const entry of readdirSync(testsDir)) {
    if (!/\.test\.ts$/.test(entry) && entry !== "run-e2e.mjs" && entry !== "run-failing.mjs") {
      continue;
    }
    copyFile(path.join(testsDir, entry), path.join(LARKY, "tests", entry));
  }

  // 4. summary
  console.log("\n== summary ==");
  console.log(
    `  new ${stats.new}  updated ${stats.update}  identical after transform (skipped) ${stats.same}`,
  );
  if (missingSources.length > 0) {
    console.log(`  missing on the swifty side (not copied): ${missingSources.join(", ")}`);
  }
  if (skippedProtected.length > 0) {
    console.log("\n== protected files left untouched (larky dual-process versions) ==");
    for (const f of skippedProtected) console.log(`  [skip  ] ${f}`);
    console.log(
      "  note: swifty-branded names inside the files above and in larky-native files\n" +
      "  (core/agent-session.ts, core/app.ts, cli/main.ts, tui/index.tsx, ...) are\n" +
      "  outside this script's scope and must be renamed manually.",
    );
  }

  // 5. not-migrated report: everything under apps/swifty that this run did
  //    not copy. Fully unmigrated directories are collapsed to "<dir>/*".
  const unmigrated = [];
  collectUnmigrated(SWIFTY, "", unmigrated);
  console.log(`\n== not migrated (relative to apps/swifty, ${String(unmigrated.length)} entries) ==`);
  for (const f of unmigrated) console.log(`  ${f}`);
}

main();
