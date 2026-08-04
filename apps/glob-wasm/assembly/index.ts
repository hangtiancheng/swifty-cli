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

// Glob semantics (aligned with Bun.Glob, same as the C++ glob-addon):
//   *        matches any number of bytes within one path segment
//   **       matches zero or more whole segments, but only when it forms a
//            complete segment ("a/**/b", "**/x", "x/**"); otherwise ("a**b",
//            "***") each star run collapses to a single *
//   ?        matches exactly one character, never '/'
//   [abc]    character class; supports ranges [a-z], negation [!x] / [^x],
//            a literal ']' as first member ([]]), and \ escapes ([\]])
//   {a,b}    brace alternates, nestable, expanded at compile time (capped)
//   \x       escapes the next character
//   !glob    leading '!' run negates the whole pattern
//
// Matching is per UTF-16 code unit (equivalent to the addon's byte-wise
// UTF-8 matching for BMP code points). Escaped '/' is not supported
// (patterns are split on '/' before per-segment matching, like minimatch).
//
// Complexity: per-segment matching uses the classic iterative star
// backtracking algorithm (O(n*m) worst case, no recursion); cross-segment
// '**' uses an iterative DP table. There is no exponential backtracking.

const MAX_PATTERN_LENGTH: i32 = 64 * 1024;
const MAX_BRACE_EXPANSIONS: i32 = 10000;
// Counts sequential groups as well as nesting; bounds expandBraces recursion.
const MAX_BRACE_DEPTH: i32 = 1000;

const STAR_PI_NONE: i32 = -1;

class PatternSegment {
  text: string = "";
  isGlobstar: bool = false; // segment is exactly "**"
}

class CompiledPattern {
  segs: PatternSegment[] = [];
  minSegments: i32 = 0; // non-globstar segment count (each consumes one)
  hasGlobstar: bool = false;
}

class CompiledGlob {
  negated: bool = false;
  hasSlash: bool = false;
  alts: CompiledPattern[] = [];
}

const gCompiled: CompiledGlob[] = [];

// ---------------------------------------------------------------------------
// Brace expansion (compile time, capped)
// ---------------------------------------------------------------------------

// Find the '}' matching the '{' at openIdx (nesting-aware, honors \ escapes).
// Returns -1 when unterminated.
function findBraceClose(pattern: string, openIdx: i32): i32 {
  let depth = 0;
  for (let i = openIdx; i < pattern.length; i++) {
    const c = pattern.charCodeAt(i);
    if (c == 0x5c) {
      // '\'
      i++;
    } else if (c == 0x7b) {
      // '{'
      depth++;
    } else if (c == 0x7d) {
      // '}'
      depth--;
      if (depth == 0) {
        return i;
      }
    }
  }
  return -1;
}

// Expand the first terminated brace group, recursing on each alternative.
// Unterminated '{' stays literal. Returns false when the expansion count
// exceeds MAX_BRACE_EXPANSIONS or nesting exceeds MAX_BRACE_DEPTH.
function expandBraces(pattern: string, out: string[], depth: i32): bool {
  if (depth > MAX_BRACE_DEPTH) {
    return false;
  }

  let open = -1;
  let close = -1;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charCodeAt(i);
    if (c == 0x5c) {
      i++;
    } else if (c == 0x7b) {
      const cl = findBraceClose(pattern, i);
      if (cl != -1) {
        open = i;
        close = cl;
        break;
      }
    }
  }

  if (open == -1) {
    if (out.length >= MAX_BRACE_EXPANSIONS) {
      return false;
    }
    out.push(pattern);
    return true;
  }

  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);

  let altStart = open + 1;
  let nested = 0;
  for (let i = open + 1; i <= close; i++) {
    const c = pattern.charCodeAt(i);
    if (c == 0x5c) {
      i++;
    } else if (c == 0x7b) {
      nested++;
    } else if (c == 0x7d && nested > 0) {
      nested--;
    } else if ((c == 0x2c && nested == 0) || i == close) {
      const alt = pattern.slice(altStart, i);
      if (!expandBraces(prefix + alt + suffix, out, depth + 1)) {
        return false;
      }
      altStart = i + 1;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Compiled pattern
// ---------------------------------------------------------------------------

function splitPatternSegments(p: string, out: CompiledPattern): void {
  let start = 0;
  for (let i = 0; i <= p.length; i++) {
    if (i == p.length || p.charCodeAt(i) == 0x2f) {
      // '/'
      const seg = p.slice(start, i);
      start = i + 1;
      const isGlobstar = seg == "**";
      if (isGlobstar) {
        out.hasGlobstar = true;
        // adjacent ** segments are equivalent to one
        const segs = out.segs;
        if (segs.length > 0 && segs[segs.length - 1].isGlobstar) {
          continue;
        }
      } else {
        out.minSegments++;
      }
      const ps = new PatternSegment();
      ps.text = seg;
      ps.isGlobstar = isGlobstar;
      out.segs.push(ps);
    }
  }
}

function compilePattern(raw: string, out: CompiledGlob): void {
  let start = 0;
  while (start < raw.length && raw.charCodeAt(start) == 0x21) {
    // '!'
    out.negated = !out.negated;
    start++;
  }
  const body = raw.slice(start);
  out.hasSlash = body.indexOf("/") != -1;

  const expanded: string[] = [];
  if (!expandBraces(body, expanded, 0)) {
    abort("glob pattern brace expansion is too large");
  }

  for (let i = 0; i < expanded.length; i++) {
    const cp = new CompiledPattern();
    splitPatternSegments(expanded[i], cp);
    out.alts.push(cp);
  }
}

// ---------------------------------------------------------------------------
// Single-segment matcher: *, ?, [class], \ escapes, literals. No '/'.
// Iterative with star backtracking; O(len(pattern) * len(text)) worst case.
// ---------------------------------------------------------------------------

// Parse the character class opening at p[open]. On success sets contentStart
// (first member index), close (index of the closing ']') and negated.
function parseClass(
  p: string,
  open: i32,
  contentStart: i32[],
  close: i32[],
  negated: bool[],
): bool {
  let j = open + 1;
  negated[0] = false;
  if (j < p.length && (p.charCodeAt(j) == 0x21 || p.charCodeAt(j) == 0x5e)) {
    negated[0] = true;
    j++;
  }
  contentStart[0] = j;
  let k = j;
  if (k < p.length && p.charCodeAt(k) == 0x5d) {
    k++; // ']' immediately after '[' (or negation) is a literal member
  }
  while (k < p.length) {
    const c = p.charCodeAt(k);
    if (c == 0x5c) {
      k++; // escaped char inside class, e.g. [\]]
    } else if (c == 0x5d) {
      close[0] = k;
      return true;
    }
    k++;
  }
  return false;
}

// Read one class member (honoring \ escapes); writes the char and returns
// the index past it.
function readClassMember(p: string, idx: i32[], close: i32): i32 {
  if (p.charCodeAt(idx[0]) == 0x5c && idx[0] + 1 < close) {
    const c = p.charCodeAt(idx[0] + 1);
    idx[0] += 2;
    return c;
  }
  const c = p.charCodeAt(idx[0]);
  idx[0] += 1;
  return c;
}

function classMatches(p: string, contentStart: i32, close: i32, c: i32): bool {
  let matched = false;
  const idx: i32[] = [0];
  let m = contentStart;
  while (m < close) {
    idx[0] = m;
    const lo = readClassMember(p, idx, close);
    if (idx[0] < close && p.charCodeAt(idx[0]) == 0x2d && idx[0] + 1 < close) {
      // '-'
      idx[0]++; // skip the range separator before reading the high member
      const hi = readClassMember(p, idx, close);
      if (lo <= c && c <= hi) {
        matched = true;
      }
      m = idx[0];
    } else {
      if (lo == c) {
        matched = true;
      }
      m = idx[0];
    }
  }
  return matched;
}

// Match a single non-star pattern element at p[pi] against char c.
// Writes the index after the element into nextPi.
function matchOne(p: string, pi: i32, c: i32, nextPi: i32[]): bool {
  const pc = p.charCodeAt(pi);
  if (pc == 0x3f) {
    // '?'
    nextPi[0] = pi + 1;
    return true; // segments never contain '/', so ? matches any char
  }
  if (pc == 0x5c) {
    // '\'
    if (pi + 1 < p.length) {
      nextPi[0] = pi + 2;
      return p.charCodeAt(pi + 1) == c;
    }
    nextPi[0] = pi + 1; // trailing backslash is a literal backslash
    return c == 0x5c;
  }
  if (pc == 0x5b) {
    // '['
    const contentStart: i32[] = [0];
    const close: i32[] = [0];
    const negated: bool[] = [false];
    if (parseClass(p, pi, contentStart, close, negated)) {
      nextPi[0] = close[0] + 1;
      const matched = classMatches(p, contentStart[0], close[0], c);
      return matched != negated[0];
    }
    nextPi[0] = pi + 1; // unterminated '[' is a literal
    return c == 0x5b;
  }
  nextPi[0] = pi + 1;
  return pc == c;
}

function segMatch(p: string, t: string): bool {
  let pi = 0;
  let ti = 0;
  let starPi = STAR_PI_NONE; // resume position after last star run
  let starTi = 0; // text position the star run started at
  const nextPi: i32[] = [0];

  while (ti < t.length) {
    if (pi < p.length) {
      if (p.charCodeAt(pi) == 0x2a) {
        // '*'
        while (pi < p.length && p.charCodeAt(pi) == 0x2a) {
          pi++; // star runs collapse to one *
        }
        starPi = pi;
        starTi = ti;
        continue;
      }
      if (matchOne(p, pi, t.charCodeAt(ti), nextPi)) {
        pi = nextPi[0];
        ti++;
        continue;
      }
    }
    if (starPi != STAR_PI_NONE) {
      starTi++; // let the star consume one more char, retry
      ti = starTi;
      pi = starPi;
      continue;
    }
    return false;
  }

  while (pi < p.length && p.charCodeAt(pi) == 0x2a) {
    pi++;
  }
  return pi == p.length;
}

// ---------------------------------------------------------------------------
// Cross-segment matching ('**' handling) via iterative DP.
// ---------------------------------------------------------------------------

function splitTextSegments(t: string, out: string[]): void {
  out.length = 0;
  let start = 0;
  for (let i = 0; i <= t.length; i++) {
    if (i == t.length || t.charCodeAt(i) == 0x2f) {
      out.push(t.slice(start, i));
      start = i + 1;
    }
  }
}

// Rolling two-row DP over rows i = P..0 where row(i)[j] means: pattern
// segments i.. match text segments j.. exactly. O(T) memory.
function matchPattern(cp: CompiledPattern, tsegs: string[], dp: u8[]): bool {
  const P = cp.segs.length;
  const T = tsegs.length;

  // Each non-globstar segment consumes exactly one text segment;
  // globstars consume zero or more.
  if (cp.minSegments > T) {
    return false;
  }
  if (!cp.hasGlobstar && P != T) {
    return false;
  }

  const width = T + 1;
  dp.length = 2 * width;
  for (let i = 0; i < dp.length; i++) {
    dp[i] = 0;
  }
  let nextOff = 0; // row i+1
  let curOff = width; // row i being computed
  dp[nextOff + T] = 1; // row P: only the empty suffix matches

  for (let ii = P - 1; ii >= 0; ii--) {
    const ps = cp.segs[ii];
    for (let jj = T; jj >= 0; jj--) {
      if (ps.isGlobstar) {
        dp[curOff + jj] = dp[nextOff + jj] | ((jj < T ? dp[curOff + jj + 1] : 0) as u8);
      } else if (jj < T) {
        dp[curOff + jj] = dp[nextOff + jj + 1] & (segMatch(ps.text, tsegs[jj]) ? 1 : 0);
      } else {
        dp[curOff + jj] = 0;
      }
    }
    const tmp = curOff;
    curOff = nextOff;
    nextOff = tmp;
  }
  return dp[nextOff] != 0; // after the last swap, `next` holds row 0
}

function matchCompiled(g: CompiledGlob, text: string, tsegScratch: string[], dpScratch: u8[]): bool {
  splitTextSegments(text, tsegScratch);
  let matched = false;
  const alts = g.alts;
  for (let i = 0; i < alts.length; i++) {
    if (matchPattern(alts[i], tsegScratch, dpScratch)) {
      matched = true;
      break;
    }
  }
  return g.negated ? !matched : matched;
}

// Can any file strictly below a directory (relative segments dirSegs) still
// match pattern cp? Over-approximates: unknown future segments are assumed
// satisfiable, so `true` means "must descend", `false` means "safe to prune".
// Rolling two-row DP; row(i)[j] means: pattern i.. can match dirSegs j..
// followed by at least one future (unknown) segment.
function canDescendPattern(cp: CompiledPattern, dirSegs: string[], dp: u8[]): bool {
  const P = cp.segs.length;
  const T = dirSegs.length;

  // Without a globstar the pattern must be strictly longer than the
  // directory path to cover the extra segments of a deeper file.
  if (!cp.hasGlobstar && P <= T) {
    return false;
  }

  const width = T + 1;
  dp.length = 2 * width;
  for (let i = 0; i < dp.length; i++) {
    dp[i] = 0;
  }
  let nextOff = 0; // row i+1; row P is all-false
  let curOff = width; // row i being computed

  for (let ii = P - 1; ii >= 0; ii--) {
    const ps = cp.segs[ii];
    // j == T: the directory path is fully consumed; a deeper file adds at
    // least one more segment, so any remaining pattern (i < P) may match.
    dp[curOff + T] = 1;
    for (let jj = T - 1; jj >= 0; jj--) {
      if (ps.isGlobstar) {
        dp[curOff + jj] = dp[nextOff + jj] | dp[curOff + jj + 1];
      } else {
        dp[curOff + jj] = dp[nextOff + jj + 1] & (segMatch(ps.text, dirSegs[jj]) ? 1 : 0);
      }
    }
    const tmp = curOff;
    curOff = nextOff;
    nextOff = tmp;
  }
  return dp[nextOff] != 0; // after the last swap, `next` holds row 0
}

// ---------------------------------------------------------------------------
// Host API
// ---------------------------------------------------------------------------

// Compile a glob pattern; returns a handle (1-based) used by the other
// exports. Aborts when the pattern exceeds MAX_PATTERN_LENGTH or brace
// expansion exceeds the safety cap.
export function compile(pattern: string): i32 {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    abort("glob pattern is too long");
  }
  const g = new CompiledGlob();
  compilePattern(pattern, g);
  gCompiled.push(g);
  return gCompiled.length;
}

// Whether the compiled pattern body contains a '/' — callers use this to
// decide between basename matching and relative-path matching.
export function hasSlash(id: i32): bool {
  return gCompiled[id - 1].hasSlash;
}

// Match `text` against the compiled pattern.
export function match(id: i32, text: string): bool {
  const g = gCompiled[id - 1];
  const tsegScratch: string[] = [];
  const dpScratch: u8[] = [];
  return matchCompiled(g, text, tsegScratch, dpScratch);
}

// Match a single pattern string against `text` without keeping a handle.
export function globMatch(pattern: string, text: string): bool {
  return match(compile(pattern), text);
}

// Pruning query: `dirPath` is the '/'-separated path of a directory
// relative to the scan root; returns whether any file strictly below it
// could still match. Over-approximates, so `true` means "must descend".
export function canDescend(id: i32, dirPath: string): bool {
  const g = gCompiled[id - 1];
  const dirSegs: string[] = [];
  if (dirPath.length > 0) {
    splitTextSegments(dirPath, dirSegs);
  }
  const dp: u8[] = [];
  const alts = g.alts;
  for (let i = 0; i < alts.length; i++) {
    if (canDescendPattern(alts[i], dirSegs, dp)) {
      return true;
    }
  }
  return false;
}

