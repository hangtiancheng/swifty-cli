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

// Feature: Verify 3-tier config priority chain (defaults → YAML → env vars)
// Design: Use vitest temp directories and environment variable isolation to cover all config source behaviors
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

// Environment variable names to save and restore
const ENV_KEYS = [
  "LARKY_CONFIG",
  "LARKY_HOST",
  "LARKY_PORT",
  "LARKY_TRACE_ENABLED",
  "LARKY_TRACE_FILE",
];

describe("config priority chain", () => {
  let origDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    origDir = process.cwd();
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    process.chdir(origDir);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        Reflect.deleteProperty(process.env, key);
      }
    }
  });

  // Feature: Verify silent skip when config file doesn't exist, use built-in defaults
  test("missing config file is silent, uses defaults", () => {
    const dir = makeTmpDir();
    process.chdir(dir);

    const cfg = getConfig();
    expect(cfg.port).toBe(5520);
  });

  // Feature: Verify LARKY_CONFIG environment variable correctly affects YAML config file load path
  test("LARKY_CONFIG env var overrides YAML path", () => {
    const dir = makeTmpDir();
    const yamlPath = path.join(dir, "custom.yaml");
    writeFileSync(yamlPath, "core:\n  port: 5555\n");
    process.chdir(dir);
    process.env.LARKY_CONFIG = yamlPath;

    const cfg = getConfig();
    expect(cfg.port).toBe(5555);
  });

  // Feature: Verify full 3-tier priority chain: defaults(5520) → YAML(6000) → env var(8000)
  test("full priority chain: env var wins", () => {
    const dir = makeTmpDir();
    const yamlPath = path.join(dir, "larky.yaml");
    writeFileSync(yamlPath, "core:\n  port: 6000\n");
    process.chdir(dir);
    process.env.LARKY_CONFIG = yamlPath;
    process.env.LARKY_PORT = "8000";

    const cfg = getConfig();
    expect(cfg.port).toBe(8000);
  });

  // Feature: Verify unknown top-level sections are silently ignored (looseObject)
  test("unknown top-level section is ignored", () => {
    const dir = makeTmpDir();
    const yamlPath = path.join(dir, "extra.yaml");
    writeFileSync(yamlPath, "unknown_section:\n  foo: bar\ncore:\n  port: 7777\n");
    process.chdir(dir);
    process.env.LARKY_CONFIG = yamlPath;

    const cfg = getConfig();
    expect(cfg.port).toBe(7777);
  });

  // Feature: Verify unknown keys within a known section still cause an error
  test("unknown key inside core section calls process.exit", () => {
    const dir = makeTmpDir();
    const yamlPath = path.join(dir, "bad.yaml");
    writeFileSync(yamlPath, "core:\n  host: localhost\n  bogus: true\n");
    process.chdir(dir);
    process.env.LARKY_CONFIG = yamlPath;

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /** noop */
    });
    expect(() => getConfig()).toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown [core] keys"));
    consoleSpy.mockRestore();
  });

  // Feature: Verify trace config is loaded from YAML
  test("trace section loaded from YAML", () => {
    const dir = makeTmpDir();
    const yamlPath = path.join(dir, "trace.yaml");
    writeFileSync(yamlPath, "trace:\n  enable: false\n  file: /tmp/my-trace.jsonl\n");
    process.chdir(dir);
    process.env.LARKY_CONFIG = yamlPath;

    const cfg = getConfig();
    expect(cfg.trace.enable).toBe(false);
    expect(cfg.trace.file).toBe("/tmp/my-trace.jsonl");
  });
});
