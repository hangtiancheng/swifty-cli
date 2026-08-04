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

// Make dist/glob.js self-contained: inject the compiled wasm as a base64
// string where the wrapper declares `GLOB_WASM_BASE64`. Consumers that
// bundle the wrapper (tsup/esbuild) then carry the module inline too.

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(dir, "..", "build", "release.wasm");
const jsPath = join(dir, "..", "dist", "glob.js");

const base64 = readFileSync(wasmPath).toString("base64");

let source = readFileSync(jsPath, "utf-8");
if (!source.includes("GLOB_WASM_BASE64")) {
  throw new Error("dist/glob.js does not reference GLOB_WASM_BASE64 — wrapper changed?");
}
source = source.replaceAll(
  /typeof GLOB_WASM_BASE64/g,
  `typeof "${base64}"`,
);
// The `typeof GLOB_WASM_BASE64 === "string"` guard now folds to a constant,
// but keep it simple: also replace any remaining bare references.
source = source.replaceAll("GLOB_WASM_BASE64", `"${base64}"`);
writeFileSync(jsPath, source);

// Ship the binary alongside the wrapper for non-bundled consumers.
copyFileSync(wasmPath, join(dir, "..", "dist", "glob.wasm"));

console.log(`embedded release.wasm (${base64.length} base64 chars) into dist/glob.js`);
