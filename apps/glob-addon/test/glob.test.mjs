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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
		assert.equal(new Glob("src/js/promise.js").match("src/js/promise.js"), true);
	});

	it("matches ** across zero or more segments", () => {
		assert.equal(new Glob("**/*.js").match("a.js"), true);
		assert.equal(new Glob("**/*.js").match("src/js/a.js"), true);
		assert.equal(new Glob("src/**").match("src/a/b.c"), true);
		assert.equal(new Glob("src/**/lc*.js").match("src/js/lc/lc2632.js"), true);
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

	it("matches nested and empty brace alternates", () => {
		assert.equal(new Glob("a.{t{s,sx},js}").match("a.tsx"), true);
		assert.equal(new Glob("a.{t{s,sx},js}").match("a.js"), true);
		assert.equal(new Glob("a{,b}").match("a"), true);
		assert.equal(new Glob("a{,b}").match("ab"), true);
		assert.equal(new Glob("a{,b}").match("ac"), false);
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
});

describe("Glob.scan", () => {
	const root = mkdtempSync(join(tmpdir(), "glob-addon-test-"));
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
		const matches = new Glob("*.js").scan({ cwd: root, exclude: ["node_modules"] });
		assert.deepEqual(matches.sort(), ["a.js", "src/js/curry.js", "src/js/promise.js"]);
	});

	it("matches path patterns against the relative path", () => {
		const matches = new Glob("src/js/*.js").scan({ cwd: root });
		assert.deepEqual(matches.sort(), ["src/js/curry.js", "src/js/promise.js"]);
	});

	it("matches brace patterns", () => {
		const matches = new Glob("*.{js,ts}").scan({ cwd: root, exclude: ["node_modules"] });
		assert.deepEqual(matches.sort(), [
			"a.js",
			"src/js/curry.js",
			"src/js/promise.js",
			"src/ts/x.ts",
		]);
	});

	it("skips dotfiles unless dot is set", () => {
		const withoutDot = new Glob("*.js").scan({ cwd: root, exclude: ["node_modules"] });
		assert.equal(withoutDot.includes(".hidden.js"), false);
		const withDot = new Glob("*.js").scan({ cwd: root, exclude: ["node_modules"], dot: true });
		assert.equal(withDot.includes(".hidden.js"), true);
	});

	it("excludes directories by name", () => {
		const matches = new Glob("**/*.js").scan({ cwd: root });
		assert.equal(matches.some((m) => m.startsWith("node_modules/")), true);
		const excluded = new Glob("**/*.js").scan({ cwd: root, exclude: ["node_modules"] });
		assert.equal(excluded.some((m) => m.startsWith("node_modules/")), false);
	});

	it("caps results at maxResults", () => {
		const matches = new Glob("**/*").scan({ cwd: root, maxResults: 2 });
		assert.equal(matches.length, 2);
	});
});
