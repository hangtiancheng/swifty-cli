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
#include <filesystem>
#include <napi.h>
#include <string>
#include <unordered_set>
#include <vector>

namespace fs = std::filesystem;

// ---------------------------------------------------------------------------
// Glob matching, aligned with Bun.Glob semantics:
// *, **, ?, [abc] / [a-z] / [!abc], {a,b} alternates (nestable),
// \ escapes, and leading ! whole-pattern negation.
// ---------------------------------------------------------------------------

// Find the '}' matching the '{' at openIdx (nesting-aware, honors \ escapes).
// Returns std::string::npos when unterminated.
static size_t findBraceClose(const std::string &pattern, size_t openIdx) {
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

static bool matchFrom(const std::string &pattern, size_t pi,
                      const std::string &text, size_t ti) {
  while (pi < pattern.size()) {
    char pc = pattern[pi];

    if (pc == '*' && pi + 1 < pattern.size() && pattern[pi + 1] == '*') {
      // ** globstar: match zero or more path segments
      size_t afterStars = pi + 2;

      if (afterStars == pattern.size()) {
        return true; // trailing ** matches everything
      }

      bool hasSlash =
          (afterStars < pattern.size() && pattern[afterStars] == '/');
      size_t restPi = hasSlash ? afterStars + 1 : afterStars;

      // Try ** matching 0 segments
      {
        size_t startI = ti;
        if (hasSlash && startI < text.size() && text[startI] == '/') {
          startI++;
        }
        if (matchFrom(pattern, restPi, text, startI))
          return true;
      }
      // Try ** matching 1, 2, ... segments (advance past each /)
      for (size_t i = ti; i < text.size(); ++i) {
        if (text[i] == '/') {
          size_t nextI = i + 1;
          if (matchFrom(pattern, restPi, text, nextI))
            return true;
        }
      }
      return false;
    }

    if (pc == '*') {
      // * single star: match any chars except '/'
      size_t restPi = pi + 1;
      for (size_t i = ti; i <= text.size(); ++i) {
        if (matchFrom(pattern, restPi, text, i))
          return true;
        if (i < text.size() && text[i] == '/')
          break;
      }
      return false;
    }

    if (pc == '{') {
      size_t close = findBraceClose(pattern, pi);
      if (close != std::string::npos) {
        // {a,b} alternates: try each alternative followed by the rest
        const std::string rest = pattern.substr(close + 1);
        size_t altStart = pi + 1;
        int depth = 0;
        for (size_t i = pi + 1; i <= close; ++i) {
          char c = pattern[i];
          if (c == '\\') {
            ++i;
          } else if (c == '{') {
            ++depth;
          } else if (c == '}' && depth > 0) {
            --depth;
          } else if ((c == ',' && depth == 0) || i == close) {
            std::string candidate =
                pattern.substr(altStart, i - altStart) + rest;
            if (matchFrom(candidate, 0, text, ti))
              return true;
            altStart = i + 1;
          }
        }
        return false;
      }
      // unterminated '{' is a literal
      if (ti >= text.size() || text[ti] != '{')
        return false;
      ++pi;
      ++ti;
      continue;
    }

    if (pc == '[') {
      size_t j = pi + 1;
      bool negatedClass = false;
      if (j < pattern.size() && (pattern[j] == '!' || pattern[j] == '^')) {
        negatedClass = true;
        ++j;
      }
      size_t close = std::string::npos;
      size_t k = j;
      if (k < pattern.size() && pattern[k] == ']') {
        ++k; // ']' right after '[' (or negation) is a literal member
      }
      for (; k < pattern.size(); ++k) {
        if (pattern[k] == ']') {
          close = k;
          break;
        }
      }
      if (close == std::string::npos) {
        // unterminated '[' is a literal
        if (ti >= text.size() || text[ti] != '[')
          return false;
        ++pi;
        ++ti;
        continue;
      }
      if (ti >= text.size() || text[ti] == '/')
        return false;
      char c = text[ti];
      bool matched = false;
      for (size_t m = j; m < close;) {
        if (m + 2 < close && pattern[m + 1] == '-') {
          if (pattern[m] <= c && c <= pattern[m + 2])
            matched = true;
          m += 3;
        } else {
          if (pattern[m] == c)
            matched = true;
          ++m;
        }
      }
      if (matched == negatedClass)
        return false;
      pi = close + 1;
      ++ti;
      continue;
    }

    if (pc == '\\' && pi + 1 < pattern.size()) {
      if (ti >= text.size() || pattern[pi + 1] != text[ti])
        return false;
      pi += 2;
      ++ti;
      continue;
    }

    if (pc == '?') {
      if (ti >= text.size() || text[ti] == '/')
        return false;
      ++pi;
      ++ti;
      continue;
    }

    if (ti >= text.size() || pc != text[ti])
      return false;
    ++pi;
    ++ti;
  }

  return ti == text.size();
}

static bool globMatchImpl(const std::string &pattern, const std::string &text) {
  size_t start = 0;
  bool negated = false;
  while (start < pattern.size() && pattern[start] == '!') {
    negated = !negated;
    ++start;
  }
  bool matched = matchFrom(pattern, start, text, 0);
  return negated ? !matched : matched;
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

static void scanDir(const fs::path &dir, const fs::path &rootDir,
                    const std::string &pattern, bool hasSlash,
                    const std::unordered_set<std::string> &excludeDirs,
                    bool includeDot, size_t maxResults,
                    std::vector<std::string> &results) {
  if (results.size() >= maxResults)
    return;

  std::vector<fs::directory_entry> entries;
  std::error_code ec;

  for (auto &entry : fs::directory_iterator(dir, ec)) {
    entries.push_back(entry);
  }

  std::sort(entries.begin(), entries.end(),
            [](const fs::directory_entry &a, const fs::directory_entry &b) {
              return a.path().filename() < b.path().filename();
            });

  for (auto &entry : entries) {
    if (results.size() >= maxResults)
      return;

    std::string name = entry.path().filename().string();

    if (entry.is_directory()) {
      if (!includeDot && !name.empty() && name[0] == '.')
        continue;
      if (excludeDirs.count(name))
        continue;
      scanDir(entry.path(), rootDir, pattern, hasSlash, excludeDirs, includeDot,
              maxResults, results);

    } else if (entry.is_regular_file()) {
      if (!includeDot && !name.empty() && name[0] == '.')
        continue;

      std::string relativePath =
          fs::relative(entry.path(), rootDir, ec).generic_string();

      const std::string &matchTarget = hasSlash ? relativePath : name;

      if (globMatchImpl(pattern, matchTarget)) {
        results.push_back(relativePath);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// N-API exports
// ---------------------------------------------------------------------------

Napi::Value GlobMatch(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "Expected (pattern: string, text: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string pattern = info[0].As<Napi::String>().Utf8Value();
  std::string text = info[1].As<Napi::String>().Utf8Value();

  return Napi::Boolean::New(env, globMatchImpl(pattern, text));
}

Napi::Value GlobScan(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "First argument (pattern) must be a string")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

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

  uint32_t maxResults = 1000;
  if (info.Length() > 4 && info[4].IsNumber()) {
    maxResults = info[4].As<Napi::Number>().Uint32Value();
  }

  bool hasSlash = pattern.find('/') != std::string::npos;
  fs::path cwdPath = fs::absolute(cwdStr).lexically_normal();
  std::vector<std::string> results;

  scanDir(cwdPath, cwdPath, pattern, hasSlash, excludeDirs, includeDot,
          maxResults, results);

  Napi::Array arr = Napi::Array::New(env, results.size());
  for (size_t i = 0; i < results.size(); ++i) {
    arr[i] = Napi::String::New(env, results[i]);
  }

  return arr;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("globMatch", Napi::Function::New(env, GlobMatch));
  exports.Set("globScan", Napi::Function::New(env, GlobScan));
  return exports;
}

NODE_API_MODULE(glob_addon, Init)
