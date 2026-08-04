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

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { Glob } from "../dist/glob.js";

describe("Glob.match", () => {
  it("matches basename patterns", () => {
    assert.equal(new Glob("*.js").match("promise.js"), true);
    assert.equal(new Glob("*.js").match("promise.md"), false);
    // * does not cross path separators
    assert.equal(new Glob("*.js").match("src/promise.js"), false);
  });

  it("matches patterns containing path separators", () => {
    assert.equal(new Glob("src/js/*.js").match("src/js/promise.js"), true);
    assert.equal(new Glob("src/js/*.js").match("promise.js"), false);
    assert.equal(new Glob("src/js/*.js").match("src/ts/promise.js"), false);
    // exact path (no wildcard)
    assert.equal(
      new Glob("src/js/promise.js").match("src/js/promise.js"),
      true,
    );
  });

  it("matches ** across zero or more segments", () => {
    assert.equal(new Glob("**/*.js").match("a.js"), true);
    assert.equal(new Glob("**/*.js").match("src/js/a.js"), true);
    assert.equal(new Glob("src/**").match("src/a/b.c"), true);
    assert.equal(new Glob("src/**/lc*.js").match("src/js/lc/lc2632.js"), true);
    // ** matches zero segments in the middle
    assert.equal(new Glob("a/**/b").match("a/b"), true);
    assert.equal(new Glob("a/**/b").match("a/x/y/b"), true);
    // trailing /** also matches the bare prefix (zero segments)
    assert.equal(new Glob("src/**").match("src"), true);
    assert.equal(new Glob("src/**").match("srcx"), false);
  });

  it("treats ** that is not a full segment as a single *", () => {
    assert.equal(new Glob("a**b").match("axb"), true);
    assert.equal(new Glob("a**b").match("ab"), true);
    assert.equal(new Glob("a**b").match("a/b"), false);
    assert.equal(new Glob("a/***/b").match("a/x/b"), true);
    assert.equal(new Glob("a/***/b").match("a/x/y/b"), false);
  });

  it("matches ? as a single non-separator character", () => {
    assert.equal(new Glob("a?c").match("abc"), true);
    assert.equal(new Glob("a?c").match("a/c"), false);
    assert.equal(new Glob("a?c").match("ac"), false);
  });

  it("matches {a,b} alternates", () => {
    assert.equal(new Glob("*.{ts,tsx}").match("a.ts"), true);
    assert.equal(new Glob("*.{ts,tsx}").match("a.tsx"), true);
    assert.equal(new Glob("*.{ts,tsx}").match("a.js"), false);
    assert.equal(new Glob("{src,test}/**/*.ts").match("src/x/y.ts"), true);
    assert.equal(new Glob("{src,test}/**/*.ts").match("lib/x/y.ts"), false);
  });

  it("matches nested, empty and single-alternative braces", () => {
    assert.equal(new Glob("a.{t{s,sx},js}").match("a.tsx"), true);
    assert.equal(new Glob("a.{t{s,sx},js}").match("a.js"), true);
    assert.equal(new Glob("a{,b}").match("a"), true);
    assert.equal(new Glob("a{,b}").match("ab"), true);
    assert.equal(new Glob("a{,b}").match("ac"), false);
    assert.equal(new Glob("a.{ts}").match("a.ts"), true);
  });

  it("matches alternates containing slashes", () => {
    assert.equal(new Glob("{src/js,lib}/*.js").match("src/js/a.js"), true);
    assert.equal(new Glob("{src/js,lib}/*.js").match("lib/a.js"), true);
    assert.equal(new Glob("{src/js,lib}/*.js").match("src/a.js"), false);
  });

  it("throws when brace expansion is too large", () => {
    const bomb = "{a,b}".repeat(20); // 2^20 alternatives
    assert.throws(() => new Glob(bomb).match("a"), RangeError);
  });

  it("allows many sequential single-alternative brace groups", () => {
    const pattern = "{a}".repeat(100);
    assert.equal(new Glob(pattern).match("a".repeat(100)), true);
    assert.equal(new Glob(pattern).match("a".repeat(99)), false);
  });

  it("throws for patterns above the length cap", () => {
    assert.throws(() => new Glob("a".repeat(64 * 1024 + 1)).match("a"), RangeError);
  });

  it("coalesces adjacent ** segments", () => {
    assert.equal(new Glob("a/**/**/b").match("a/b"), true);
    assert.equal(new Glob("a/**/**/b").match("a/x/y/b"), true);
    assert.equal(new Glob("**/**").match("x"), true);
  });

  it("matches character classes with ranges and negation", () => {
    assert.equal(new Glob("lc[0-9]*.js").match("lc2632.js"), true);
    assert.equal(new Glob("lc[0-9]*.js").match("lcx.js"), false);
    assert.equal(new Glob("[abc]x").match("bx"), true);
    assert.equal(new Glob("[abc]x").match("dx"), false);
    assert.equal(new Glob("[!a]x").match("bx"), true);
    assert.equal(new Glob("[!a]x").match("ax"), false);
    assert.equal(new Glob("[^a]x").match("bx"), true);
    // class never matches a separator
    assert.equal(new Glob("a[/]b").match("a/b"), false);
    // '-' at the edge is a literal member, not a range
    assert.equal(new Glob("[a-]x").match("-x"), true);
    assert.equal(new Glob("[a-]x").match("ax"), true);
    assert.equal(new Glob("[a-]x").match("bx"), false);
  });

  it("supports backslash escapes inside character classes", () => {
    assert.equal(new Glob("[\\]]x").match("]x"), true);
    assert.equal(new Glob("[\\]]x").match("ax"), false);
    // escaped '-' is a literal member, not a range
    assert.equal(new Glob("[a\\-c]x").match("-x"), true);
    assert.equal(new Glob("[a\\-c]x").match("bx"), false);
  });

  it("treats ] right after [ as a literal member", () => {
    assert.equal(new Glob("[]]x").match("]x"), true);
    assert.equal(new Glob("[]]x").match("ax"), false);
  });

  it("treats unterminated [ and { as literals", () => {
    assert.equal(new Glob("a[b").match("a[b"), true);
    assert.equal(new Glob("a{b").match("a{b"), true);
    assert.equal(new Glob("a{b").match("ab"), false);
  });

  it("honors backslash escapes", () => {
    assert.equal(new Glob("a\\*b").match("a*b"), true);
    assert.equal(new Glob("a\\*b").match("axb"), false);
    assert.equal(new Glob("a\\?b").match("a?b"), true);
  });

  it("negates the whole pattern with leading !", () => {
    assert.equal(new Glob("!*.js").match("a.md"), true);
    assert.equal(new Glob("!*.js").match("a.js"), false);
    assert.equal(new Glob("!!*.js").match("a.js"), true);
  });

  it("matches non-ASCII file names", () => {
    assert.equal(new Glob("*.js").match("\u4e2d\u6587.js"), true);
    assert.equal(
      new Glob("src/**/*.md").match("src/\u6587\u6863/\u8bf4\u660e.md"),
      true,
    );
  });

  it("rejects pathological star backtracking quickly", () => {
    const started = Date.now();
    const matched = new Glob("*a*a*a*a*a*a*a*a*a*b").match("a".repeat(60));
    const elapsed = Date.now() - started;
    assert.equal(matched, false);
    assert.ok(elapsed < 1000, `pathological match took ${elapsed}ms`);
  });
});

describe("Glob.scan", () => {
  const root = mkdtempSync(join(tmpdir(), "glob-wasm-test-"));
  mkdirSync(join(root, "src", "js"), { recursive: true });
  mkdirSync(join(root, "src", "ts"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "a.js"), "top\n");
  writeFileSync(join(root, "b.md"), "notes\n");
  writeFileSync(join(root, ".hidden.js"), "dot\n");
  writeFileSync(join(root, "src", "js", "promise.js"), "class PromiseV2 {}\n");
  writeFileSync(join(root, "src", "js", "curry.js"), "function curry() {}\n");
  writeFileSync(join(root, "src", "ts", "x.ts"), "export {};\n");
  writeFileSync(join(root, "node_modules", "pkg", "index.js"), "dep\n");

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("matches basename patterns recursively and returns / separated paths", () => {
    const matches = new Glob("*.js").scan({
      cwd: root,
      exclude: ["node_modules"],
    });
    assert.deepEqual(matches.sort(), [
      "a.js",
      "src/js/curry.js",
      "src/js/promise.js",
    ]);
  });

  it("matches path patterns against the relative path", () => {
    const matches = new Glob("src/js/*.js").scan({ cwd: root });
    assert.deepEqual(matches.sort(), ["src/js/curry.js", "src/js/promise.js"]);
  });

  it("matches brace patterns", () => {
    const matches = new Glob("*.{js,ts}").scan({
      cwd: root,
      exclude: ["node_modules"],
    });
    assert.deepEqual(matches.sort(), [
      "a.js",
      "src/js/curry.js",
      "src/js/promise.js",
      "src/ts/x.ts",
    ]);
  });

  it("still descends into directories named by other brace alternatives", () => {
    const matches = new Glob("{src,other}/js/*.js").scan({ cwd: root });
    assert.deepEqual(matches.sort(), ["src/js/curry.js", "src/js/promise.js"]);
  });

  it("supports negated patterns", () => {
    const matches = new Glob("!*.{js,ts}").scan({
      cwd: root,
      exclude: ["node_modules"],
    });
    assert.deepEqual(matches.sort(), ["b.md"]);
  });

  it("skips dotfiles unless dot is set", () => {
    const withoutDot = new Glob("*.js").scan({
      cwd: root,
      exclude: ["node_modules"],
    });
    assert.equal(withoutDot.includes(".hidden.js"), false);
    const withDot = new Glob("*.js").scan({
      cwd: root,
      exclude: ["node_modules"],
      dot: true,
    });
    assert.equal(withDot.includes(".hidden.js"), true);
  });

  it("excludes directories by name", () => {
    const matches = new Glob("**/*.js").scan({ cwd: root });
    assert.equal(
      matches.some((m) => m.startsWith("node_modules/")),
      true,
    );
    const excluded = new Glob("**/*.js").scan({
      cwd: root,
      exclude: ["node_modules"],
    });
    assert.equal(
      excluded.some((m) => m.startsWith("node_modules/")),
      false,
    );
  });

  it("caps results at maxResults", () => {
    const matches = new Glob("**/*").scan({ cwd: root, maxResults: 2 });
    assert.equal(matches.length, 2);
  });

  it("rejects a negative maxResults", () => {
    assert.throws(
      () => new Glob("*.js").scan({ cwd: root, maxResults: -1 }),
      TypeError,
    );
  });

  it("throws for a missing or non-directory cwd", () => {
    assert.throws(
      () => new Glob("*.js").scan({ cwd: join(root, "does-not-exist") }),
      /ENOENT/,
    );
    assert.throws(
      () => new Glob("*.js").scan({ cwd: join(root, "a.js") }),
      /ENOTDIR/,
    );
  });

  it("finds files with non-ASCII names", () => {
    const dir = mkdtempSync(join(tmpdir(), "glob-wasm-unicode-"));
    try {
      mkdirSync(join(dir, "\u76ee\u5f55"));
      writeFileSync(join(dir, "\u76ee\u5f55", "\u4e2d\u6587.js"), "\n");
      const matches = new Glob("**/*.js").scan({ cwd: dir });
      assert.deepEqual(matches, ["\u76ee\u5f55/\u4e2d\u6587.js"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("survives symlink cycles and does not follow symlinked directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "glob-wasm-symlink-"));
    try {
      mkdirSync(join(dir, "real"));
      writeFileSync(join(dir, "real", "f.js"), "\n");
      symlinkSync(dir, join(dir, "real", "loop")); // cycle back to the root
      symlinkSync(join(dir, "missing"), join(dir, "broken")); // dangling

      const matches = new Glob("**/*.js").scan({ cwd: dir });
      assert.deepEqual(matches, ["real/f.js"]);
      assert.equal(
        matches.some((m) => m.includes("loop/")),
        false,
      );

      // the symlink itself is reported as a plain file entry
      const links = new Glob("**/loop").scan({ cwd: dir });
      assert.deepEqual(links, ["real/loop"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes unrelated directory branches without losing matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "glob-wasm-prune-"));
    try {
      mkdirSync(join(dir, "src", "a", "b"), { recursive: true });
      mkdirSync(join(dir, "vendor", "deep", "deeper"), { recursive: true });
      writeFileSync(join(dir, "src", "a", "b", "hit.ts"), "\n");
      writeFileSync(join(dir, "vendor", "deep", "deeper", "miss.ts"), "\n");
      const matches = new Glob("src/**/*.ts").scan({ cwd: dir });
      assert.deepEqual(matches, ["src/a/b/hit.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
