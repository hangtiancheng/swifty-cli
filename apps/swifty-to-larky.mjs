#!/usr/bin/env node
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
}

main();
