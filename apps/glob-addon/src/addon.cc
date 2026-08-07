// Copyright (c) 2026 hangtiancheng
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <limits>
#include <napi.h>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

namespace fs = std::filesystem;

// ---------------------------------------------------------------------------
// Glob semantics (aligned with Bun.Glob):
//   *        matches any number of bytes within one path segment
//   **       matches zero or more whole segments, but only when it forms a
//            complete segment ("a/**/b", "**/x", "x/**"); otherwise ("a**b",
//            "***") each star run collapses to a single *
//   ?        matches exactly one byte, never '/'
//   [abc]    character class; supports ranges [a-z], negation [!x] / [^x],
//            a literal ']' as first member ([]]), and \ escapes ([\]])
//   {a,b}    brace alternates, nestable, expanded at compile time (capped)
//   \x       escapes the next character
//   !glob    leading '!' run negates the whole pattern
//
// Dot handling (the `dot` flag of match/scan): when false, a name that
// starts with '.' is only matched by a pattern segment that itself starts
// with a literal '.' (or the escape "\."); '*', '?', '[...]' never match a
// leading dot and '**' never consumes a dot-leading segment. When true,
// wildcards match dot names like any other character.
//
// Matching is byte-wise over UTF-8. Escaped '/' is not supported (patterns
// are split on '/' before per-segment matching, like minimatch).
//
// Complexity: per-segment matching uses the classic iterative star
// backtracking algorithm (O(n*m) worst case, no recursion); cross-segment
// '**' uses an iterative DP table. There is no exponential backtracking.
// ---------------------------------------------------------------------------

namespace {

constexpr size_t kMaxPatternLength = 64 * 1024;
constexpr size_t kMaxBraceExpansions = 10000;
// Counts sequential groups as well as nesting; bounds expandBraces recursion.
constexpr int kMaxBraceDepth = 1000;

// ---------------------------------------------------------------------------
// UTF-8 <-> fs::path helpers (portable across the C++17/C++20 char8_t split)
// ---------------------------------------------------------------------------

std::string pathFilenameUtf8(const fs::path &p) {
#if defined(__cpp_lib_char8_t)
  std::u8string s = p.filename().u8string();
  return std::string(s.begin(), s.end());
#else
  return p.filename().u8string();
#endif
}

fs::path pathFromUtf8(const std::string &s) {
#if defined(__cpp_lib_char8_t)
  return fs::path(std::u8string(s.begin(), s.end()));
#else
  return fs::u8path(s);
#endif
}

// ---------------------------------------------------------------------------
// Brace expansion (compile time, capped)
// ---------------------------------------------------------------------------

// Find the '}' matching the '{' at openIdx (nesting-aware, honors \ escapes).
// Returns std::string::npos when unterminated.
size_t findBraceClose(const std::string &pattern, size_t openIdx) {
  int depth = 0;
  for (size_t i = openIdx; i < pattern.size(); ++i) {
    char c = pattern[i];
    if (c == '\\') {
      ++i;
    } else if (c == '{') {
      ++depth;
    } else if (c == '}') {
      --depth;
      if (depth == 0)
        return i;
    }
  }
  return std::string::npos;
}

// Expand the first terminated brace group, recursing on each alternative.
// Unterminated '{' stays literal. Returns false when the expansion count
// exceeds kMaxBraceExpansions or nesting exceeds kMaxBraceDepth.
bool expandBraces(const std::string &pattern, std::vector<std::string> &out,
                  int depth) {
  if (depth > kMaxBraceDepth)
    return false;

  size_t open = std::string::npos;
  size_t close = std::string::npos;
  for (size_t i = 0; i < pattern.size(); ++i) {
    char c = pattern[i];
    if (c == '\\') {
      ++i;
    } else if (c == '{') {
      size_t cl = findBraceClose(pattern, i);
      if (cl != std::string::npos) {
        open = i;
        close = cl;
        break;
      }
    }
  }

  if (open == std::string::npos) {
    if (out.size() >= kMaxBraceExpansions)
      return false;
    out.push_back(pattern);
    return true;
  }

  const std::string prefix = pattern.substr(0, open);
  const std::string suffix = pattern.substr(close + 1);

  size_t altStart = open + 1;
  int nested = 0;
  for (size_t i = open + 1; i <= close; ++i) {
    char c = pattern[i];
    if (c == '\\') {
      ++i;
    } else if (c == '{') {
      ++nested;
    } else if (c == '}' && nested > 0) {
      --nested;
    } else if ((c == ',' && nested == 0) || i == close) {
      std::string alt = pattern.substr(altStart, i - altStart);
      if (!expandBraces(prefix + alt + suffix, out, depth + 1))
        return false;
      altStart = i + 1;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Compiled pattern
// ---------------------------------------------------------------------------

struct PatternSegment {
  std::string text;
  bool isGlobstar; // segment is exactly "**"
};

struct CompiledPattern {
  std::vector<PatternSegment> segs;
  size_t minSegments = 0; // non-globstar segment count (each consumes one)
  bool hasGlobstar = false;
};

struct CompiledGlob {
  bool negated = false;
  bool hasSlash = false;
  std::vector<CompiledPattern> alts;
};

void splitPatternSegments(const std::string &p, CompiledPattern &out) {
  size_t start = 0;
  for (size_t i = 0; i <= p.size(); ++i) {
    if (i == p.size() || p[i] == '/') {
      std::string seg = p.substr(start, i - start);
      start = i + 1;
      bool isGlobstar = (seg == "**");
      if (isGlobstar) {
        out.hasGlobstar = true;
        // adjacent ** segments are equivalent to one
        if (!out.segs.empty() && out.segs.back().isGlobstar)
          continue;
      } else {
        ++out.minSegments;
      }
      out.segs.push_back({std::move(seg), isGlobstar});
    }
  }
}

bool compileGlob(const std::string &raw, CompiledGlob &out, std::string &err) {
  if (raw.size() > kMaxPatternLength) {
    err = "glob pattern is too long (limit: " +
          std::to_string(kMaxPatternLength) + " bytes)";
    return false;
  }

  size_t start = 0;
  while (start < raw.size() && raw[start] == '!') {
    out.negated = !out.negated;
    ++start;
  }
  const std::string body = raw.substr(start);
  out.hasSlash = body.find('/') != std::string::npos;

  std::vector<std::string> expanded;
  if (!expandBraces(body, expanded, 0)) {
    err = "glob pattern brace expansion is too large (limit: " +
          std::to_string(kMaxBraceExpansions) + " alternatives, depth " +
          std::to_string(kMaxBraceDepth) + ")";
    return false;
  }

  out.alts.reserve(expanded.size());
  for (const std::string &p : expanded) {
    CompiledPattern cp;
    splitPatternSegments(p, cp);
    out.alts.push_back(std::move(cp));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Single-segment matcher: *, ?, [class], \ escapes, literals. No '/'.
// Iterative with star backtracking; O(len(pattern) * len(text)) worst case.
// ---------------------------------------------------------------------------

// Parse the character class opening at p[open]. On success sets contentStart
// (first member index), close (index of the closing ']') and negated.
bool parseClass(const std::string &p, size_t open, size_t &contentStart,
                size_t &close, bool &negated) {
  size_t j = open + 1;
  negated = false;
  if (j < p.size() && (p[j] == '!' || p[j] == '^')) {
    negated = true;
    ++j;
  }
  contentStart = j;
  size_t k = j;
  if (k < p.size() && p[k] == ']')
    ++k; // ']' immediately after '[' (or negation) is a literal member
  for (; k < p.size(); ++k) {
    if (p[k] == '\\') {
      ++k; // escaped char inside class, e.g. [\]]
    } else if (p[k] == ']') {
      close = k;
      return true;
    }
  }
  return false;
}

// Read one class member (honoring \ escapes); advances idx past it.
unsigned char readClassMember(const std::string &p, size_t &idx, size_t close) {
  if (p[idx] == '\\' && idx + 1 < close) {
    unsigned char c = static_cast<unsigned char>(p[idx + 1]);
    idx += 2;
    return c;
  }
  unsigned char c = static_cast<unsigned char>(p[idx]);
  idx += 1;
  return c;
}

bool classMatches(const std::string &p, size_t contentStart, size_t close,
                  unsigned char c) {
  bool matched = false;
  size_t m = contentStart;
  while (m < close) {
    size_t loEnd = m;
    unsigned char lo = readClassMember(p, loEnd, close);
    if (loEnd < close && p[loEnd] == '-' && loEnd + 1 < close) {
      size_t hiEnd = loEnd + 1;
      unsigned char hi = readClassMember(p, hiEnd, close);
      if (lo <= c && c <= hi)
        matched = true;
      m = hiEnd;
    } else {
      if (lo == c)
        matched = true;
      m = loEnd;
    }
  }
  return matched;
}

// Match a single non-star pattern element at p[pi] against byte c.
// Sets nextPi to the index after the element.
bool matchOne(const std::string &p, size_t pi, char c, size_t &nextPi) {
  char pc = p[pi];
  if (pc == '?') {
    nextPi = pi + 1;
    return true; // segments never contain '/', so ? matches any byte
  }
  if (pc == '\\') {
    if (pi + 1 < p.size()) {
      nextPi = pi + 2;
      return p[pi + 1] == c;
    }
    nextPi = pi + 1; // trailing backslash is a literal backslash
    return c == '\\';
  }
  if (pc == '[') {
    size_t contentStart, close;
    bool negated;
    if (parseClass(p, pi, contentStart, close, negated)) {
      nextPi = close + 1;
      bool matched =
          classMatches(p, contentStart, close, static_cast<unsigned char>(c));
      return matched != negated;
    }
    nextPi = pi + 1; // unterminated '[' is a literal
    return c == '[';
  }
  nextPi = pi + 1;
  return pc == c;
}

bool startsWithDot(const std::string &s) { return !s.empty() && s[0] == '.'; }

// A pattern segment may match a dot-leading name (with dot=false) only when
// it starts with a literal '.' — plain "." or the escape "\.". A character
// class like "[.]" does not count, mirroring minimatch/picomatch.
bool segCanMatchDot(const std::string &p) {
  if (p.empty())
    return false;
  if (p[0] == '.')
    return true;
  return p[0] == '\\' && p.size() > 1 && p[1] == '.';
}

bool segMatch(const std::string &p, const std::string &t, bool dot) {
  if (!dot && startsWithDot(t) && !segCanMatchDot(p))
    return false;

  size_t pi = 0, ti = 0;
  size_t starPi = std::string::npos; // resume position after last star run
  size_t starTi = 0;                 // text position the star run started at

  while (ti < t.size()) {
    if (pi < p.size()) {
      if (p[pi] == '*') {
        while (pi < p.size() && p[pi] == '*')
          ++pi; // star runs collapse to one *
        starPi = pi;
        starTi = ti;
        continue;
      }
      size_t nextPi;
      if (matchOne(p, pi, t[ti], nextPi)) {
        pi = nextPi;
        ++ti;
        continue;
      }
    }
    if (starPi != std::string::npos) {
      ++starTi; // let the star consume one more byte, retry
      ti = starTi;
      pi = starPi;
      continue;
    }
    return false;
  }

  while (pi < p.size() && p[pi] == '*')
    ++pi;
  return pi == p.size();
}

// ---------------------------------------------------------------------------
// Cross-segment matching ('**' handling) via iterative DP.
// ---------------------------------------------------------------------------

void splitTextSegments(const std::string &t, std::vector<std::string> &out) {
  out.clear();
  size_t start = 0;
  for (size_t i = 0; i <= t.size(); ++i) {
    if (i == t.size() || t[i] == '/') {
      out.emplace_back(t, start, i - start);
      start = i + 1;
    }
  }
}

// Rolling two-row DP over rows i = P..0 where row(i)[j] means: pattern
// segments i.. match text segments j.. exactly. O(T) memory.
bool matchPattern(const CompiledPattern &cp,
                  const std::vector<std::string> &tsegs, bool dot,
                  std::vector<uint8_t> &dp) {
  const size_t P = cp.segs.size();
  const size_t T = tsegs.size();

  // Each non-globstar segment consumes exactly one text segment;
  // globstars consume zero or more.
  if (cp.minSegments > T)
    return false;
  if (!cp.hasGlobstar && P != T)
    return false;

  dp.assign(2 * (T + 1), 0);
  uint8_t *next = dp.data();          // row i+1
  uint8_t *cur = dp.data() + (T + 1); // row i being computed
  next[T] = 1;                        // row P: only the empty suffix matches

  for (size_t ii = P; ii-- > 0;) {
    const PatternSegment &ps = cp.segs[ii];
    for (size_t jj = T + 1; jj-- > 0;) {
      if (ps.isGlobstar) {
        const bool canConsume =
            jj < T && (dot || !startsWithDot(tsegs[jj]));
        cur[jj] = next[jj] || (canConsume && cur[jj + 1]);
      } else if (jj < T) {
        cur[jj] = next[jj + 1] && segMatch(ps.text, tsegs[jj], dot);
      } else {
        cur[jj] = 0;
      }
    }
    std::swap(cur, next);
  }
  return next[0] != 0; // after the last swap, `next` holds row 0
}

bool matchCompiled(const CompiledGlob &g, const std::string &text, bool dot,
                   std::vector<std::string> &tsegScratch,
                   std::vector<uint8_t> &dpScratch) {
  splitTextSegments(text, tsegScratch);
  bool matched = false;
  for (const CompiledPattern &cp : g.alts) {
    if (matchPattern(cp, tsegScratch, dot, dpScratch)) {
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
bool canDescendPattern(const CompiledPattern &cp,
                       const std::vector<std::string> &dirSegs, bool dot,
                       std::vector<uint8_t> &dp) {
  const size_t P = cp.segs.size();
  const size_t T = dirSegs.size();

  // Without a globstar the pattern must be strictly longer than the
  // directory path to cover the extra segments of a deeper file.
  if (!cp.hasGlobstar && P <= T)
    return false;

  dp.assign(2 * (T + 1), 0);
  uint8_t *next = dp.data();          // row i+1; row P is all-false
  uint8_t *cur = dp.data() + (T + 1); // row i being computed

  for (size_t ii = P; ii-- > 0;) {
    const PatternSegment &ps = cp.segs[ii];
    // j == T: the directory path is fully consumed; a deeper file adds at
    // least one more segment, so any remaining pattern (i < P) may match.
    cur[T] = 1;
    for (size_t jj = T; jj-- > 0;) {
      if (ps.isGlobstar) {
        const bool canConsume = dot || !startsWithDot(dirSegs[jj]);
        cur[jj] = next[jj] || (canConsume && cur[jj + 1]);
      } else {
        cur[jj] = next[jj + 1] && segMatch(ps.text, dirSegs[jj], dot);
      }
    }
    std::swap(cur, next);
  }
  return next[0] != 0; // after the last swap, `next` holds row 0
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

struct ScanState {
  const CompiledGlob &glob;
  const std::unordered_set<std::string> &excludeDirs;
  bool includeDot;
  size_t maxResults;
  std::vector<std::string> results;
  // incremental state (avoids fs::relative and its per-file syscalls)
  std::string relPrefix; // "" at root, otherwise "a/b/"
  std::vector<std::string> dirSegs;
  // reusable scratch buffers
  std::vector<std::string> tsegScratch;
  std::vector<uint8_t> dpScratch;
};

struct ScanEntry {
  std::string name;
  fs::path path;
  bool isDir;
};

void scanDir(const fs::path &dir, ScanState &st) {
  if (st.results.size() >= st.maxResults)
    return;

  std::error_code ec;
  fs::directory_iterator it(dir, ec);
  if (ec)
    return; // unreadable directory: skip silently
  const fs::directory_iterator end;

  std::vector<ScanEntry> entries;
  for (; !ec && it != end; it.increment(ec)) {
    const fs::directory_entry &entry = *it;

    std::string name = pathFilenameUtf8(entry.path());
    // Dot entries are no longer skipped wholesale: the matcher enforces the
    // explicit-dot rule, so `**/.github/*.yml` can still traverse `.github`.
    // Negated patterns keep the legacy wildcard-only view of the tree.
    if (!st.includeDot && st.glob.negated && !name.empty() && name[0] == '.')
      continue;

    std::error_code sec;
    fs::file_status ls = entry.symlink_status(sec);
    if (sec)
      continue;

    switch (ls.type()) {
    case fs::file_type::directory:
      entries.push_back({std::move(name), entry.path(), true});
      break;
    case fs::file_type::regular:
    case fs::file_type::symlink:
      // Symlinks are never followed: a symlink (to anything, or broken) is
      // reported as a plain file entry. This makes symlink cycles harmless.
      entries.push_back({std::move(name), entry.path(), false});
      break;
    default:
      break; // fifo, socket, device, unknown
    }
  }

  std::sort(
      entries.begin(), entries.end(),
      [](const ScanEntry &a, const ScanEntry &b) { return a.name < b.name; });

  const bool canPrune = st.glob.hasSlash && !st.glob.negated;

  for (ScanEntry &entry : entries) {
    if (st.results.size() >= st.maxResults)
      return;

    if (entry.isDir) {
      if (st.excludeDirs.count(entry.name))
        continue;

      if (canPrune) {
        st.dirSegs.push_back(entry.name);
        bool descend = false;
        for (const CompiledPattern &cp : st.glob.alts) {
          if (canDescendPattern(cp, st.dirSegs, st.includeDot, st.dpScratch)) {
            descend = true;
            break;
          }
        }
        st.dirSegs.pop_back();
        if (!descend)
          continue;
      } else if (!st.includeDot && !entry.name.empty() &&
                 entry.name[0] == '.') {
        // Basename patterns walk the tree via an implicit `**`, which never
        // crosses dot directories when dot matching is off.
        continue;
      }

      const size_t prevLen = st.relPrefix.size();
      st.relPrefix += entry.name;
      st.relPrefix += '/';
      st.dirSegs.push_back(entry.name);

      scanDir(entry.path, st);

      st.dirSegs.pop_back();
      st.relPrefix.resize(prevLen);
    } else {
      bool matched;
      if (st.glob.hasSlash) {
        std::string relativePath = st.relPrefix + entry.name;
        matched = matchCompiled(st.glob, relativePath, st.includeDot,
                                st.tsegScratch, st.dpScratch);
        if (matched)
          st.results.push_back(std::move(relativePath));
      } else {
        matched = matchCompiled(st.glob, entry.name, st.includeDot,
                                st.tsegScratch, st.dpScratch);
        if (matched)
          st.results.push_back(st.relPrefix + entry.name);
      }
    }
  }
}

} // namespace

// ---------------------------------------------------------------------------
// N-API exports
// ---------------------------------------------------------------------------

Napi::Value GlobMatch(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env,
                         "Expected (pattern: string, text: string, dot?: "
                         "boolean)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  try {
    std::string pattern = info[0].As<Napi::String>().Utf8Value();
    std::string text = info[1].As<Napi::String>().Utf8Value();
    bool dot = false;
    if (info.Length() > 2 && info[2].IsBoolean()) {
      dot = info[2].As<Napi::Boolean>().Value();
    }

    CompiledGlob glob;
    std::string err;
    if (!compileGlob(pattern, glob, err)) {
      Napi::RangeError::New(env, err).ThrowAsJavaScriptException();
      return env.Null();
    }

    std::vector<std::string> tsegScratch;
    std::vector<uint8_t> dpScratch;
    return Napi::Boolean::New(
        env, matchCompiled(glob, text, dot, tsegScratch, dpScratch));
  } catch (const std::exception &e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Null();
  }
}

Napi::Value GlobScan(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "First argument (pattern) must be a string")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  try {
    std::string pattern = info[0].As<Napi::String>().Utf8Value();

    std::string cwdStr = ".";
    if (info.Length() > 1 && info[1].IsString()) {
      cwdStr = info[1].As<Napi::String>().Utf8Value();
    }

    std::unordered_set<std::string> excludeDirs;
    if (info.Length() > 2 && info[2].IsArray()) {
      Napi::Array arr = info[2].As<Napi::Array>();
      for (uint32_t i = 0; i < arr.Length(); ++i) {
        Napi::Value v = arr[i];
        if (v.IsString()) {
          excludeDirs.insert(v.As<Napi::String>().Utf8Value());
        }
      }
    }

    bool includeDot = false;
    if (info.Length() > 3 && info[3].IsBoolean()) {
      includeDot = info[3].As<Napi::Boolean>().Value();
    }

    size_t maxResults = 1000;
    if (info.Length() > 4 && info[4].IsNumber()) {
      double d = info[4].As<Napi::Number>().DoubleValue();
      if (std::isnan(d) || d < 0) {
        Napi::TypeError::New(env, "maxResults must be a non-negative number")
            .ThrowAsJavaScriptException();
        return env.Null();
      }
      d = std::floor(d);
      constexpr double kMax =
          static_cast<double>(std::numeric_limits<uint32_t>::max());
      maxResults = static_cast<size_t>(std::min(d, kMax));
    }

    CompiledGlob glob;
    std::string err;
    if (!compileGlob(pattern, glob, err)) {
      Napi::RangeError::New(env, err).ThrowAsJavaScriptException();
      return env.Null();
    }

    std::error_code ec;
    fs::path cwdPath = fs::absolute(pathFromUtf8(cwdStr), ec);
    if (!ec)
      cwdPath = cwdPath.lexically_normal();
    fs::file_status st = ec ? fs::file_status() : fs::status(cwdPath, ec);
    if (ec || st.type() == fs::file_type::not_found) {
      Napi::Error::New(env, "ENOENT: no such directory, scan '" + cwdStr + "'")
          .ThrowAsJavaScriptException();
      return env.Null();
    }
    if (st.type() != fs::file_type::directory) {
      Napi::Error::New(env, "ENOTDIR: not a directory, scan '" + cwdStr + "'")
          .ThrowAsJavaScriptException();
      return env.Null();
    }

    ScanState state{glob, excludeDirs, includeDot, maxResults, {},
                    {},   {},          {},         {}};
    scanDir(cwdPath, state);

    Napi::Array arr = Napi::Array::New(env, state.results.size());
    for (size_t i = 0; i < state.results.size(); ++i) {
      arr[i] = Napi::String::New(env, state.results[i]);
    }
    return arr;
  } catch (const std::exception &e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Null();
  }
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("globMatch", Napi::Function::New(env, GlobMatch));
  exports.Set("globScan", Napi::Function::New(env, GlobScan));
  return exports;
}

NODE_API_MODULE(glob_addon, Init)
