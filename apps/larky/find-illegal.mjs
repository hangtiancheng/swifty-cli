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

// Recursively scan all git-tracked files under the current directory for
// illegal words (case-sensitive): "swifty" (excluding "swifty.js"), "Swifty",
// and "SWIFTY". The git repository root is two levels above this directory,
// but only files within this directory are inspected.
//
// Usage: node find-illegal.mjs

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

/**
 * @typedef {Object} IllegalMatch
 * @property {string} file - Relative file path from the scan root.
 * @property {number} line - 1-based line number where the match was found.
 * @property {number} column - 1-based column number of the match start.
 * @property {string} word - The illegal word that was matched.
 * @property {string} context - The full line content for reference.
 */

/**
 * @typedef {Object} ScanResult
 * @property {IllegalMatch[]} matches - All illegal word occurrences found.
 * @property {number} filesScanned - Total number of files scanned.
 */

/**
 * Illegal word patterns. Each entry defines a regex and a human-readable label.
 * The lowercase "swifty" pattern uses a negative lookahead to exclude "swifty.js".
 * @type {ReadonlyArray<{ pattern: RegExp, label: string }>}
 */
const ILLEGAL_PATTERNS = [
  { pattern: /swifty(?!\.js)/g, label: "swifty" },
  { pattern: /Swifty/g, label: "Swifty" },
  { pattern: /SWIFTY/g, label: "SWIFTY" },
];

/**
 * Resolve the directory to scan (the directory where this script resides).
 * @type {string}
 */
const SCAN_DIR = resolve(import.meta.dirname);

/**
 * Resolve the git repository root (two levels above the scan directory).
 * @type {string}
 */
const GIT_ROOT = resolve(SCAN_DIR, "..", "..");

/**
 * Retrieve all git-tracked files under the scan directory.
 * Uses `git ls-files` executed from the scan directory so that only files
 * within this subtree are returned.
 * @returns {string[]} Array of absolute file paths.
 */
function getTrackedFiles() {
  const output = execSync("git ls-files", {
    cwd: SCAN_DIR,
    encoding: "utf-8",
  });
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((f) => resolve(SCAN_DIR, f));
}

/**
 * Scan a single file's content for illegal words.
 * @param {string} filePath - Absolute path to the file.
 * @param {string} content - The file content to scan.
 * @returns {IllegalMatch[]} Matches found in this file.
 */
function scanContent(filePath, content) {
  /** @type {IllegalMatch[]} */
  const results = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, label } of ILLEGAL_PATTERNS) {
      // Reset lastIndex since the regex is global and reused across lines
      pattern.lastIndex = 0;
      /** @type {RegExpExecArray | null} */
      let match;
      while ((match = pattern.exec(line)) !== null) {
        results.push({
          file: relative(SCAN_DIR, filePath),
          line: i + 1,
          column: match.index + 1,
          word: label,
          context: line,
        });
      }
    }
  }

  return results;
}

/**
 * Main entry point: scan all tracked files and report illegal words.
 * @returns {ScanResult}
 */
function main() {
  const files = getTrackedFiles();
  /** @type {IllegalMatch[]} */
  const allMatches = [];

  for (const filePath of files) {
    /** @type {string} */
    let content;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      // Skip files that cannot be read (e.g. broken symlinks)
      continue;
    }

    // Skip binary files (heuristic: contains null bytes in the first 8KB)
    if (content.slice(0, 8192).includes("\0")) {
      continue;
    }

    const matches = scanContent(filePath, content);
    allMatches.push(...matches);
  }

  return { matches: allMatches, filesScanned: files.length };
}

const { matches, filesScanned } = main();

console.log(
  `[find-illegal] scanned ${filesScanned} git-tracked file(s) under ${relative(GIT_ROOT, SCAN_DIR)}/`,
);

if (matches.length === 0) {
  console.log("[find-illegal] no illegal words found");
  process.exit(0);
}

console.log(`[find-illegal] found ${matches.length} illegal occurrence(s):\n`);

for (const m of matches) {
  console.log(`  ${m.file}:${m.line}:${m.column}  [${m.word}]`);
  console.log(`    ${m.context.trim()}\n`);
}

process.exit(1);
