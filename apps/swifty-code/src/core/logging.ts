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

// Initialize pino logger from config with file rotation support.
//
// Both output formats ("json" and "text") are written synchronously in-process:
// - json: raw pino JSON lines
// - text: pino JSON lines re-formatted to `level=INFO ts=... source=... msg="..."`
//   (matches the old Python text format)
//
// File output uses a self-implemented synchronous size-based rotating
// destination (10MB per file, 5 backups — same as Python RotatingFileHandler)
// instead of the pino-roll transport. This avoids two problems at once:
// transport worker threads cannot apply a custom text formatter, and they can
// drop the last few log lines on process.exit because flushing is async.
import fs from "node:fs";
import path from "node:path";

import pino from "pino";

import { expandUser, type SwiftyConfig } from "./config.js";

type PinoLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

// Log rotation settings (matches Python RotatingFileHandler: 10MB, 5 backups)
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_BACKUPS = 5;

// Level aliases beyond pino's native levels (Python logging compat)
const LEVEL_ALIASES: Record<string, PinoLevel> = {
  critical: "fatal",
  fatal: "fatal",
  error: "error",
  warning: "warn",
  warn: "warn",
  info: "info",
  debug: "debug",
  trace: "trace",
  notset: "trace",
};

// pino numeric level -> Python-style text label (for the text format)
const TEXT_LEVEL_LABELS: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARNING",
  50: "ERROR",
  60: "CRITICAL",
};

// Record keys already rendered by the text formatter (not re-emitted as extras)
const TEXT_CORE_KEYS = new Set(["level", "time", "msg", "pid", "hostname", "name"]);

// Unknown level strings already warned about (warn once per value)
const warnedUnknownLevels = new Set<string>();

// Convert config level string to pino-compatible PinoLevel
function toPinoLevel(raw: string): PinoLevel {
  const lower = raw.toLowerCase();
  const mapped = LEVEL_ALIASES[lower];
  if (mapped !== undefined) return mapped;
  if (!warnedUnknownLevels.has(lower)) {
    warnedUnknownLevels.add(lower);
    process.stderr.write(
      `swifty: unknown log level ${JSON.stringify(raw)}, falling back to "info"\n`,
    );
  }
  return "info";
}

// Type guard for plain objects
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Format one pino JSON line as the old Python text format:
//   level=INFO ts=2026-01-01T00:00:00.000Z source=swifty-core msg="hello"
// Extra bound fields are appended as key=value pairs. Non-JSON input is
// passed through unchanged so nothing is ever silently dropped.
export function formatTextLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed === "") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return line;
  }
  if (!isRecord(parsed)) return line;
  const record = parsed;

  const rawLevel = record["level"];
  let label = "INFO";
  if (typeof rawLevel === "number") {
    label = TEXT_LEVEL_LABELS[rawLevel] ?? String(rawLevel);
  } else if (typeof rawLevel === "string") {
    label = rawLevel.toUpperCase();
  }

  const rawTime = record["time"];
  let ts: string;
  if (typeof rawTime === "string") {
    ts = rawTime;
  } else if (typeof rawTime === "number") {
    ts = new Date(rawTime).toISOString();
  } else {
    ts = new Date().toISOString();
  }

  const source = typeof record["name"] === "string" ? record["name"] : "swifty-core";
  const msg = typeof record["msg"] === "string" ? record["msg"] : "";

  let out = `level=${label} ts=${ts} source=${source} msg=${JSON.stringify(msg)}`;
  for (const [key, value] of Object.entries(record)) {
    if (TEXT_CORE_KEYS.has(key)) continue;
    out += ` ${key}=${JSON.stringify(value)}`;
  }
  return `${out}\n`;
}

// Minimal destination contract shared by process.stderr, pino destinations
// and our own rotating file destination
interface WritableDestination {
  write(msg: string): unknown;
}

// Destination wrapper that re-formats pino JSON lines as text before
// forwarding them to the underlying destination
class TextFormatStream implements pino.DestinationStream {
  private readonly dest: WritableDestination;

  constructor(dest: WritableDestination) {
    this.dest = dest;
  }

  write(msg: string): void {
    this.dest.write(formatTextLine(msg));
  }
}

// Synchronous size-based rotating file destination
// (same semantics as Python RotatingFileHandler: when the file would exceed
// maxSize, roll core.log -> core.log.1 -> ... -> core.log.N, dropping the
// oldest). Writes use fs.writeSync so nothing is lost on process.exit and no
// transport worker thread is involved.
export class RotatingFileDestination implements pino.DestinationStream {
  private readonly filePath: string;
  private readonly maxSize: number;
  private readonly maxBackups: number;
  private fd: number | undefined;
  private size = 0;

  constructor(
    filePath: string,
    maxSize: number = MAX_LOG_SIZE_BYTES,
    maxBackups: number = MAX_BACKUPS,
  ) {
    this.filePath = filePath;
    this.maxSize = maxSize;
    this.maxBackups = maxBackups;
  }

  write(msg: string): void {
    if (msg === "") return;
    const buf = Buffer.from(msg, "utf8");
    if (this.fd === undefined) this.open();
    if (this.size > 0 && this.size + buf.length > this.maxSize) this.roll();
    if (this.fd === undefined) return;
    fs.writeSync(this.fd, buf);
    this.size += buf.length;
  }

  // Open (creating parent directories if needed) and track current size
  private open(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.fd = fs.openSync(this.filePath, "a");
    this.size = fs.fstatSync(this.fd).size;
  }

  // Shift backups (core.log.4 -> core.log.5, ..., core.log -> core.log.1)
  // then reopen a fresh file; the oldest backup beyond maxBackups is dropped
  private roll(): void {
    if (this.fd !== undefined) {
      fs.closeSync(this.fd);
      this.fd = undefined;
    }
    for (let i = this.maxBackups - 1; i >= 1; i--) {
      const src = `${this.filePath}.${String(i)}`;
      if (fs.existsSync(src)) fs.renameSync(src, `${this.filePath}.${String(i + 1)}`);
    }
    if (fs.existsSync(this.filePath)) fs.renameSync(this.filePath, `${this.filePath}.1`);
    this.open();
  }
}

// Module-level logger singleton (set by setupLogging)
let moduleLogger: pino.Logger | undefined;
let fallbackLogger: pino.Logger | undefined;

// Return the logger created by setupLogging; safe to call before setup
// (returns a stderr fallback logger until setupLogging runs)
export function getLogger(): pino.Logger {
  if (moduleLogger) return moduleLogger;
  fallbackLogger ??= pino({ level: "info" }, pino.destination(2));
  return fallbackLogger;
}

// Create and return pino logger instance from config
export function setupLogging(config: SwiftyConfig): pino.Logger {
  const level = toPinoLevel(config.logging.level);
  const isJson = config.logging.format === "json";

  // Wrap each destination in the text formatter unless json output is requested
  const wrap = (dest: WritableDestination): pino.DestinationStream =>
    isJson ? dest : new TextFormatStream(dest);

  const streams: pino.StreamEntry[] = [
    // stderr output
    { stream: wrap(process.stderr), level },
  ];

  // Optional file output with synchronous size-based rotation
  // (matches Python RotatingFileHandler: 10MB per file, 5 backups kept)
  if (config.logging.file) {
    const logPath = expandUser(config.logging.file);
    streams.push({ stream: wrap(new RotatingFileDestination(logPath)), level });
  }

  const logger = pino(
    {
      level,
      // text format renders an ISO ts= field; json keeps pino's default epoch time
      ...(isJson ? {} : { timestamp: pino.stdTimeFunctions.isoTime }),
    },
    pino.multistream(streams),
  );

  moduleLogger = logger;
  return logger;
}
