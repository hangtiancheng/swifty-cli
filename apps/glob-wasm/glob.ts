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

import { existsSync, readFileSync, readdirSync, lstatSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The build step embeds the compiled module here as a base64 string so the
// published/bundled package has no runtime file dependency. Empty in source.
declare const GLOB_WASM_BASE64: string | undefined;

interface WasmExports {
  memory: WebAssembly.Memory;
  compile(pattern: number): number;
  hasSlash(id: number): number;
  match(id: number, text: number): number;
  canDescend(id: number, dirPath: number): number;
  __new(size: number, id: number): number;
  __pin(ptr: number): number;
  __unpin(ptr: number): void;
}

let wasm: WasmExports | null = null;

// Minimal AssemblyScript runtime imports: abort surfaces as a real JS error
// (e.g. brace-expansion cap), the rest keep the loader stubs satisfied.
function abortWasm(
  messagePtr: number,
  _fileNamePtr: number,
  _line: number,
  _column: number,
): void {
  void messagePtr;
  void _fileNamePtr;
  void _line;
  void _column;
  throw new RangeError("@swifty.js/glob-wasm: glob compile aborted (pattern too complex)");
}

function instantiate(bytes: Uint8Array): WasmExports {
  const result = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: {
      abort: abortWasm,
      "Date.now": () => Date.now(),
      seed: () => Math.random() * Number.MAX_SAFE_INTEGER,
    },
  });
  return result.exports as unknown as WasmExports;
}

function loadWasm(): WasmExports {
  if (wasm) {
    return wasm;
  }
  // Candidate locations for the wasm binary:
  // 1. package layout — dist/glob.js next to dist/glob.wasm
  // 2. bundled layout — consumers (e.g. swifty's tsup build) inline this
  //    wrapper and copy glob.wasm next to their bundle entry.
  // 3. source layout — running from the package checkout (build/release.wasm)
  const candidates = [
    new URL("./glob.wasm", import.meta.url),
    new URL("./release.wasm", import.meta.url),
    new URL("../build/release.wasm", import.meta.url),
  ];
  for (const url of candidates) {
    const path = fileURLToPath(url);
    if (existsSync(path)) {
      wasm = instantiate(readFileSync(path));
      return wasm;
    }
  }
  const embedded = typeof GLOB_WASM_BASE64 === "string" ? GLOB_WASM_BASE64 : "";
  if (embedded.length > 0) {
    wasm = instantiate(new Uint8Array(Buffer.from(embedded, "base64")));
    return wasm;
  }
  throw new Error(
    `@swifty.js/glob-wasm: glob.wasm not found (searched: ${candidates
      .map((u) => fileURLToPath(u))
      .join(", ")})`,
  );
}

// AssemblyScript passes strings by pointer; write the UTF-16 payload
// (length-prefixed, as the runtime expects) into linear memory ourselves —
// no dependency on the generated loader needed. The pointer is pinned for
// the call and unpinned right after so the GC can reclaim it.
function withString<T>(exports: WasmExports, str: string, fn: (ptr: number) => T): T {
  // id 2 = String; payload is 2 bytes per UTF-16 code unit
  const ptr = exports.__new(str.length << 1, 2);
  const view = new Uint16Array(exports.memory.buffer, ptr, str.length);
  for (let i = 0; i < str.length; i++) {
    view[i] = str.charCodeAt(i);
  }
  exports.__pin(ptr);
  try {
    return fn(ptr);
  } finally {
    exports.__unpin(ptr);
  }
}

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
 * Glob matcher backed by a WebAssembly module (AssemblyScript port of the
 * native glob addon).
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
 * - Symlinks are never followed: they are reported as plain files and
 *   symlinked directories are not descended into (cycle-safe).
 * - Throws if `cwd` does not exist or is not a directory, if brace
 *   expansion exceeds the safety cap, or if the pattern exceeds 64 KiB.
 */
export class Glob {
  readonly pattern: string;
  readonly dot: boolean;

  private id = 0;

  constructor(pattern: string, options?: GlobOptions) {
    this.pattern = pattern;
    this.dot = options?.dot ?? false;
  }

  private ensureCompiled(): WasmExports {
    if (this.id === 0) {
      const exports = loadWasm();
      // Mirrors the addon: the cap is enforced at compile time, in UTF-8
      // bytes (multi-byte characters count accordingly).
      if (Buffer.byteLength(this.pattern, "utf-8") > 64 * 1024) {
        throw new RangeError("glob pattern is too long (limit: 65536 bytes)");
      }
      this.id = withString(exports, this.pattern, (ptr) => exports.compile(ptr));
    }
    return wasm as WasmExports;
  }

  match(text: string): boolean {
    const exports = this.ensureCompiled();
    return withString(exports, text, (ptr) => exports.match(this.id, ptr)) !== 0;
  }

  scan(options?: GlobScanOptions): string[] {
    // Compile first, like the addon: an invalid pattern (brace bomb, over
    // the length cap) errors out before any cwd/maxResults validation.
    const exports = this.ensureCompiled();

    let maxResults = 1000;
    if (options?.maxResults !== undefined) {
      const d = options.maxResults;
      if (typeof d !== "number" || Number.isNaN(d) || d < 0) {
        throw new TypeError("maxResults must be a non-negative number");
      }
      maxResults = Math.min(Math.floor(d), 0xffff_ffff);
    }

    const cwdStr = options?.cwd ?? ".";
    try {
      // statSync follows symlinks like the addon's fs::status
      if (!statSync(cwdStr).isDirectory()) {
        throw new Error(`ENOTDIR: not a directory, scan '${cwdStr}'`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("ENOTDIR")) {
        throw err;
      }
      throw new Error(`ENOENT: no such directory, scan '${cwdStr}'`);
    }

    const excludeDirs = new Set(options?.exclude ?? []);
    const includeDot = options?.dot ?? this.dot;
    const hasSlash = exports.hasSlash(this.id) !== 0;
    // Leading '!' runs toggle negation (odd count => negated), same as the
    // addon. Pruning only helps (and is only applied) for positive slash
    // patterns.
    let bangs = 0;
    while (bangs < this.pattern.length && this.pattern.charCodeAt(bangs) === 0x21) {
      bangs++;
    }
    const canPrune = hasSlash && bangs % 2 === 0;

    const results: string[] = [];

    const scanDir = (dirAbs: string, relPrefix: string): void => {
      if (results.length >= maxResults) {
        return;
      }

      let names: string[];
      try {
        names = readdirSync(dirAbs);
      } catch {
        return; // unreadable directory: skip silently
      }

      interface Entry {
        name: string;
        isDir: boolean;
      }
      const entries: Entry[] = [];
      for (const name of names) {
        if (!includeDot && name.length > 0 && name.charAt(0) === ".") {
          continue;
        }
        let type: "dir" | "file" | "other";
        try {
          const st = lstatSync(`${dirAbs}/${name}`);
          if (st.isDirectory()) {
            type = "dir";
          } else if (st.isFile() || st.isSymbolicLink()) {
            // Symlinks are never followed: a symlink (to anything, or
            // broken) is reported as a plain file entry. This makes
            // symlink cycles harmless.
            type = "file";
          } else {
            type = "other"; // fifo, socket, device, unknown
          }
        } catch {
          continue;
        }
        if (type !== "other") {
          entries.push({ name, isDir: type === "dir" });
        }
      }

      // code-unit order, like the addon's std::sort on UTF-8 names
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

      for (const entry of entries) {
        if (results.length >= maxResults) {
          return;
        }

        if (entry.isDir) {
          if (excludeDirs.has(entry.name)) {
            continue;
          }

          if (canPrune) {
            const dirPath = relPrefix + entry.name;
            const descend = withString(exports, dirPath, (ptr) =>
              exports.canDescend(this.id, ptr),
            );
            if (!descend) {
              continue;
            }
          }

          scanDir(`${dirAbs}/${entry.name}`, relPrefix + entry.name + "/");
        } else {
          if (hasSlash) {
            const relativePath = relPrefix + entry.name;
            const matched = withString(exports, relativePath, (ptr) =>
              exports.match(this.id, ptr),
            );
            if (matched) {
              results.push(relativePath);
            }
          } else {
            const matched = withString(exports, entry.name, (ptr) =>
              exports.match(this.id, ptr),
            );
            if (matched) {
              results.push(relPrefix + entry.name);
            }
          }
        }
      }
    };

    scanDir(cwdStr, "");
    return results;
  }
}
