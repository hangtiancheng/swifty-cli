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

import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "tui" });

import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const MAX_INLINE_BYTES = 100_000;

// Expand @path references in a user message by inlining the referenced files'
// contents (resolved relative to workDir). Tokens that don't resolve to a small
// readable file are left untouched.
export function expandAtRefs(text: string, workDir: string): string {
  const refs = [...text.matchAll(/(?:^|\s)@([^\s]+)/g)].map((m) => m[1]);
  if (refs.length === 0) {
    return text;
  }

  let appendix = "";
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    const p = isAbsolute(ref) ? ref : join(workDir, ref);
    try {
      const st = statSync(p);
      if (st.isFile() && st.size <= MAX_INLINE_BYTES) {
        appendix += `\n\n<file path="${ref}">\n${readFileSync(p, "utf-8")}\n</file>`;
      }
    } catch (err) {
      log.error({ err }, "tui operation failed");
      // not a readable file → leave the @token as literal text
    }
  }
  return appendix ? text + appendix : text;
}
