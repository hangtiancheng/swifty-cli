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

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatTextLine, RotatingFileDestination, setupLogging } from "../src/core/logging.js";
import type { SwiftyConfig } from "../src/core/config.js";

// Build a minimal SwiftyConfig for logging tests
function loggingConfig(format: string, file: string): SwiftyConfig {
  return {
    host: "127.0.0.1",
    port: 7437,
    logging: { level: "info", file, format },
    agent: { maxSteps: 5 },
    llm: { defaultModel: "claude-3", router: "static" },
    trace: { enabled: false, file: "", includeLlmPayload: false },
    permission: { timeoutS: 60 },
    compaction: {
      autoThreshold: 0.8,
      toolResultLimit: 10000,
      toolResultKeep: 5000,
    },
    mcp: { servers: [] },
  };
}

describe("logging", () => {
  let dir: string;

  beforeEach(() => {
    dir = path.join(
      tmpdir(),
      `test-logging-${String(Date.now())}-${String(process.hrtime.bigint())}`,
    );
    mkdirSync(dir, { recursive: true });
    // Silence the always-on stderr channel so tests don't flood the output
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  // Feature: text format produces Python-style text lines, not JSON
  // Design: log via setupLogging(format=text) with a file target, read the
  // file back, assert level=INFO/ts=/msg= layout and that the line is not JSON
  test("text format writes `level=INFO ...` lines (not JSON) to the file", () => {
    const file = path.join(dir, "core.log");
    const logger = setupLogging(loggingConfig("text", file));

    logger.info("hello text");

    const content = readFileSync(file, "utf8");
    const line = content.trim().split("\n")[0];
    expect(line.startsWith("level=INFO ")).toBe(true);
    expect(line).toContain("ts=");
    expect(line).toContain("source=");
    expect(line).toContain('msg="hello text"');
    expect(() => {
      JSON.parse(line);
    }).toThrow();
  });

  // Feature: text format renders warn/error with Python-style labels
  // Design: log warn and error, assert level=WARNING and level=ERROR lines
  test("text format maps warn/error to WARNING/ERROR labels", () => {
    const file = path.join(dir, "core.log");
    const logger = setupLogging(loggingConfig("text", file));

    logger.warn("careful");
    logger.error("boom");

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines[0]).toContain("level=WARNING ");
    expect(lines[0]).toContain('msg="careful"');
    expect(lines[1]).toContain("level=ERROR ");
    expect(lines[1]).toContain('msg="boom"');
  });

  // Feature: json format is unchanged — file output stays pure pino JSON
  // Design: log via setupLogging(format=json), parse the file line as JSON
  // and check standard pino fields (numeric level, msg)
  test("json format still writes valid JSON lines to the file", () => {
    const file = path.join(dir, "core.log");
    const logger = setupLogging(loggingConfig("json", file));

    logger.info("hello json");

    const line = readFileSync(file, "utf8").trim().split("\n")[0];
    const parsed: unknown = JSON.parse(line);
    expect(parsed).toMatchObject({ level: 30, msg: "hello json" });
  });

  // Feature: size-based rotation (Python RotatingFileHandler semantics)
  // Design: use a small maxSize, write past the limit, expect core.log.1 to
  // appear and core.log to restart from the overflowing message
  test("rotates core.log to core.log.1 when the size limit is exceeded", () => {
    const file = path.join(dir, "core.log");
    const dest = new RotatingFileDestination(file, 100, 5);

    const line = `${"x".repeat(59)}\n`; // 60 bytes per line
    dest.write(line); // 60 bytes, no roll
    dest.write(line); // would be 120 > 100 -> roll first

    expect(existsSync(`${file}.1`)).toBe(true);
    expect(readFileSync(`${file}.1`, "utf8")).toBe(line);
    expect(readFileSync(file, "utf8")).toBe(line);
  });

  // Feature: rotation keeps at most maxBackups files
  // Design: force several rolls with maxBackups=2 and check that only
  // core.log.1 / core.log.2 exist afterwards
  test("rotation drops backups beyond the configured limit", () => {
    const file = path.join(dir, "core.log");
    const dest = new RotatingFileDestination(file, 10, 2);

    for (let i = 0; i < 5; i++) {
      dest.write(`line-${String(i)}-aaaa\n`); // each write exceeds 10 bytes -> roll every time
    }

    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(existsSync(`${file}.2`)).toBe(true);
    expect(existsSync(`${file}.3`)).toBe(false);
  });

  // Feature: end-to-end rotation through setupLogging (default 10MB limit)
  // Design: point the logger at a file pre-filled near the 10MB cap is slow;
  // instead log >10MB of messages and verify core.log.1 is produced
  test("setupLogging file channel rotates after exceeding 10MB", () => {
    const file = path.join(dir, "core.log");
    const logger = setupLogging(loggingConfig("json", file));

    const payload = "y".repeat(64 * 1024);
    for (let i = 0; i < 170; i++) {
      logger.info(payload); // ~64KB per line * 170 > 10MB
    }

    expect(existsSync(`${file}.1`)).toBe(true);
  });

  // Feature: formatTextLine tolerates extra fields and non-JSON input
  // Design: feed a pino line with an extra bound field and a raw text line
  test("formatTextLine appends extra fields and passes through non-JSON", () => {
    const formatted = formatTextLine(
      '{"level":30,"time":"2026-01-01T00:00:00.000Z","pid":1,"hostname":"h","runId":"r1","msg":"go"}\n',
    );
    expect(formatted).toBe(
      'level=INFO ts=2026-01-01T00:00:00.000Z source=swifty-core msg="go" runId="r1"\n',
    );

    expect(formatTextLine("not json\n")).toBe("not json\n");
  });
});
