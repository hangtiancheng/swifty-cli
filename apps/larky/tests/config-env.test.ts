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

// Feature: Verify 3-tier config priority chain (defaults → global YAML → local YAML)
// Design: Use vitest temp directories to cover all config source behaviors
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getConfig } from "../src/core/config.js";

// Create unique temp directory for each test
function makeTmpDir(): string {
  const dir = path.join(
    tmpdir(),
    `larky-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("config priority chain", () => {
  let origDir: string;

  beforeEach(() => {
    origDir = process.cwd();
  });

  afterEach(() => {
    process.chdir(origDir);
  });

  // Feature: Verify silent skip when config file doesn't exist, use built-in defaults
  test("missing config file is silent, uses defaults", () => {
    const dir = makeTmpDir();
    process.chdir(dir);

    const cfg = getConfig();
    expect(cfg.port).toBe(5520);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.trace).toBe(true);
  });

  // Feature: Verify local .larky/config.yaml overrides defaults
  test("local config.yaml overrides defaults", () => {
    const dir = makeTmpDir();
    mkdirSync(path.join(dir, ".larky"), { recursive: true });
    writeFileSync(path.join(dir, ".larky", "config.yaml"), "core:\n  port: 5555\n");
    process.chdir(dir);

    const cfg = getConfig();
    expect(cfg.port).toBe(5555);
  });

  // Feature: Verify unknown top-level sections are silently ignored (looseObject)
  test("unknown top-level section is ignored", () => {
    const dir = makeTmpDir();
    mkdirSync(path.join(dir, ".larky"), { recursive: true });
    writeFileSync(
      path.join(dir, ".larky", "config.yaml"),
      "unknown_section:\n  foo: bar\ncore:\n  port: 7777\n",
    );
    process.chdir(dir);

    const cfg = getConfig();
    expect(cfg.port).toBe(7777);
  });

  // Feature: Verify unknown keys within a known section still cause an error
  test("unknown key inside core section calls process.exit", () => {
    const dir = makeTmpDir();
    mkdirSync(path.join(dir, ".larky"), { recursive: true });
    writeFileSync(
      path.join(dir, ".larky", "config.yaml"),
      "core:\n  host: localhost\n  bogus: true\n",
    );
    process.chdir(dir);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /** noop */
    });
    expect(() => getConfig()).toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown [core] keys"));
    consoleSpy.mockRestore();
  });

  // Feature: Verify trace config is loaded from YAML
  test("core.trace loaded from YAML", () => {
    const dir = makeTmpDir();
    mkdirSync(path.join(dir, ".larky"), { recursive: true });
    writeFileSync(path.join(dir, ".larky", "config.yaml"), "core:\n  trace: false\n");
    process.chdir(dir);

    const cfg = getConfig();
    expect(cfg.trace).toBe(false);
  });
});
