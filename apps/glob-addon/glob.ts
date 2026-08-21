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

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

interface Binding {
  globMatch: (pattern: string, text: string, dot: boolean) => boolean;
  globScan: (
    pattern: string,
    cwd: string | null,
    excludeDirs: string[] | null,
    dot: boolean | null,
    maxResults: number | null,
  ) => string[];
}

function loadBinding(): Binding {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "x64" : process.arch;
  const prebuild = `${platform}-${arch}`;
  const candidates = [
    new URL("../build/Release/glob_addon.node", import.meta.url),
    new URL("./build/Release/glob_addon.node", import.meta.url),
    new URL(`../prebuilds/${prebuild}/glob_addon.node`, import.meta.url),
    new URL(`./prebuilds/${prebuild}/glob_addon.node`, import.meta.url),
    new URL("./glob_addon.node", import.meta.url),
  ];
  for (const url of candidates) {
    const path = fileURLToPath(url);
    if (existsSync(path)) {
      return require(path) as Binding;
    }
  }
  throw new Error(
    `@swifty.js/glob-addon: glob_addon.node not found (searched: ${candidates
      .map((u) => fileURLToPath(u))
      .join(", ")})`,
  );
}

const binding = loadBinding();

export interface GlobScanOptions {
  cwd?: string;
  exclude?: string[];
  dot?: boolean;
  maxResults?: number;
}

export interface GlobOptions {
  dot?: boolean;
}

/**
 * Glob matcher backed by the native addon.
 *
 * Pattern syntax: `*` (within a segment), `**` (zero or more whole segments;
 * a `**` that is not a complete segment, e.g. `a**b`, behaves like `*`),
 * `?`, `[a-z]` / `[!a-z]` classes with `\` escapes, `{a,b}` alternates
 * (nestable, expansion capped), `\` escapes, and leading `!` negation.
 *
 * `scan()` notes:
 * - A pattern without `/` is matched against basenames at every depth
 *   (so `*.js` finds matches recursively); patterns with `/` match the
 *   `/`-separated path relative to `cwd`.
 * - Dot handling follows minimatch/picomatch: wildcards (`*`, `?`, `[...]`,
 *   `**`) never match a name starting with `.` unless `dot` is set, but a
 *   pattern segment that starts with a literal `.` (e.g. `.github` in
 *   `**\/.github/workflows/*.yml`) always matches, including during
 *   directory traversal.
 * - Symlinks are never followed: they are reported as plain files and
 *   symlinked directories are not descended into (cycle-safe).
 * - Throws if `cwd` does not exist or is not a directory, if brace
 *   expansion exceeds the safety cap, or if the pattern exceeds 64 KiB.
 */
export class Glob {
  readonly pattern: string;
  readonly dot: boolean;

  constructor(pattern: string, options?: GlobOptions) {
    this.pattern = pattern;
    this.dot = options?.dot ?? false;
  }

  match(text: string): boolean {
    return binding.globMatch(this.pattern, text, this.dot);
  }

  scan(options?: GlobScanOptions): string[] {
    return binding.globScan(
      this.pattern,
      options?.cwd ?? null,
      options?.exclude ?? null,
      options?.dot ?? this.dot,
      options?.maxResults ?? null,
    );
  }
}
