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

// The entry file of your WebAssembly module.

// assembly/index.ts

// Export the match function for JavaScript calls.
// @param pattern - Glob pattern, e.g., "src/**/*.ts"
// @param text - Relative path to match, e.g., "src/utils/math.ts"
export function match(pattern: string, text: string): bool {
  return matchInternal(pattern, 0, text, 0);
}

// Internal recursive matching logic
function matchInternal(pattern: string, pIdx: i32, text: string, tIdx: i32): bool {
  while (pIdx < pattern.length && tIdx < text.length) {
    let p = pattern.charCodeAt(pIdx);
    let t = text.charCodeAt(tIdx);

    if (p == 42) { // '*'
      // Handle '**' (matches any number of directory levels)
      if (pIdx + 1 < pattern.length && pattern.charCodeAt(pIdx + 1) == 42) {
        pIdx += 2;
        // Skip the following '/' if present
        if (pIdx < pattern.length && pattern.charCodeAt(pIdx) == 47) {
          pIdx++;
        }
        // Recursively attempt to match the remaining part
        for (let i = tIdx; i <= text.length; i++) {
          if (matchInternal(pattern, pIdx, text, i)) return true;
        }
        return false;
      } else {
        // Single '*' (matches any character except '/')
        pIdx++;
        for (let i = tIdx; i <= text.length; i++) {
          // Stop matching if '/' is encountered
          if (i > tIdx && text.charCodeAt(i - 1) == 47) break;
          if (matchInternal(pattern, pIdx, text, i)) return true;
        }
        return false;
      }
    } else if (p == 63) { // '?'
      // '?' matches any single character except '/'
      if (t == 47) return false;
      pIdx++;
      tIdx++;
    } else {
      // Exact match for regular characters
      if (p != t) return false;
      pIdx++;
      tIdx++;
    }
  }

  // Ignore trailing '*' at the end of the pattern
  while (pIdx < pattern.length && pattern.charCodeAt(pIdx) == 42) {
    pIdx++;
    if (pIdx < pattern.length && pattern.charCodeAt(pIdx) == 42) pIdx++;
  }

  return pIdx == pattern.length && tIdx == text.length;
}
