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

// CLI trace command: display daemon trace log with filtering and color output
import { readFileSync, statSync, createReadStream } from "node:fs";
import readline from "node:readline";

import { z } from "zod";

import { findLatestTraceFile } from "../../core/config.js";

const COLORS: Record<string, string> = {
  "CLIENT→CORE": "\x1b[36m", // cyan
  "CORE→CLIENT": "\x1b[33m", // yellow
  CORE: "\x1b[32m", // green
  "CORE→LLM": "\x1b[35m", // magenta
  "LLM→CORE": "\x1b[34m", // blue
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

interface TraceRecord {
  ts: string;
  direction: string;
  layer: string;
  kind: string;
  run_id: string | null;
  step: number | null;
  client_id: string | null;
  data: Record<string, unknown>;
}

// Trace line schema: ts/direction/layer/kind/data are required (a line failing
// them is silently skipped); run_id/step/client_id leniently degrade to null
const TraceRecordSchema = z.object({
  ts: z.string(),
  direction: z.string(),
  layer: z.string(),
  kind: z.string(),
  run_id: z.string().nullable().catch(null),
  step: z.number().nullable().catch(null),
  client_id: z.string().nullable().catch(null),
  data: z.record(z.string(), z.unknown()),
});

// Per-kind lenient payload schemas for summarize(): wrongly-typed or missing
// nested values degrade to the historical fallbacks instead of failing
const CommandDataSchema = z.object({
  method: z.unknown(),
  params: z.object({ goal: z.string().catch("") }).catch({ goal: "" }),
});

const ResponseResultSchema = z.object({ run_id: z.string() });

const ErrorDataSchema = z.object({
  error: z
    .object({ code: z.unknown(), message: z.unknown() })
    .catch({ code: undefined, message: undefined }),
});

const ApiCallDataSchema = z.object({
  messages: z.array(z.unknown()).optional().catch(undefined),
  message_count: z.number().optional().catch(undefined),
  tool_schemas: z.array(z.unknown()).optional().catch(undefined),
  tool_count: z.number().optional().catch(undefined),
});

const ApiResponseDataSchema = z.object({
  stop_reason: z.unknown(),
  latency_ms: z.unknown(),
  usage: z
    .object({ output_tokens: z.number().optional().catch(undefined) })
    .catch({ output_tokens: undefined }),
});

function str(v: unknown): string {
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number") {
    return String(v);
  }
  return JSON.stringify(v ?? "");
}

function summarize(record: TraceRecord): string {
  const data = record.data;
  const kind = record.kind;

  if (kind === "command") {
    const d = CommandDataSchema.parse(data);
    const suffix = d.params.goal ? `  goal="${d.params.goal.slice(0, 50)}"` : "";
    return `method=${str(d.method)}${suffix}`;
  }

  if (kind === "response") {
    const result = ResponseResultSchema.safeParse(data.result);
    if (result.success) {
      return `run_id=${result.data.run_id.slice(0, 8)}`;
    }
    return JSON.stringify(data.result ?? "").slice(0, 60);
  }

  if (kind === "error") {
    const d = ErrorDataSchema.parse(data);
    return `code=${str(d.error.code)}  ${str(d.error.message)}`;
  }

  if (kind === "push") {
    return `event=${str(data.event_type)}  sub=${str(data.sub_id)}`;
  }

  if (kind === "event") {
    return `type=${str(data.type)}`;
  }

  if (kind === "api_call") {
    const d = ApiCallDataSchema.parse(data);
    const count = d.messages ? d.messages.length : (d.message_count ?? "?");
    const tc = d.tool_schemas ? d.tool_schemas.length : (d.tool_count ?? "?");
    return `msgs=${String(count)}  tools=${String(tc)}`;
  }

  if (kind === "api_response") {
    const d = ApiResponseDataSchema.parse(data);
    const outTokens = d.usage.output_tokens ?? "?";
    return `stop=${str(d.stop_reason)}  latency=${str(d.latency_ms)}ms  out_tokens=${String(outTokens)}`;
  }

  return JSON.stringify(data).slice(0, 60);
}

function printRecord(record: TraceRecord): void {
  const color = COLORS[record.direction] ?? "";
  const ts = record.ts.length >= 23 ? record.ts.slice(11, 23) : record.ts;
  const direction = record.direction.padEnd(14);
  const kind = record.kind.padEnd(13);
  const runId = record.run_id ? `run=${record.run_id.slice(0, 8)}` : "";
  const step = record.step !== null ? `step=${String(record.step)}` : "";
  const summary = summarize(record);

  console.log(
    `${ts}  ${color}${BOLD}${direction}${RESET}  ${kind}  ${[runId, step, summary].filter(Boolean).join("  ")}`,
  );
}

function processLine(
  line: string,
  runId: string | null,
  layer: string | undefined,
  direction: string | undefined,
  raw: boolean,
): void {
  if (!line.trim()) {
    return;
  }
  try {
    const result = TraceRecordSchema.safeParse(JSON.parse(line));
    if (!result.success) {
      return;
    }
    const record: TraceRecord = result.data;

    // Apply filters
    if (runId && record.run_id !== runId) {
      return;
    }
    if (layer && record.layer !== layer) {
      return;
    }
    if (direction && record.direction !== direction) {
      return;
    }

    if (raw) {
      console.log(line);
    } else {
      printRecord(record);
    }
  } catch {
    // Skip malformed lines
  }
}

export function cmdTrace(
  runId: string | null,
  options?: {
    layer?: string;
    direction?: string;
    raw?: boolean;
    follow?: boolean;
  },
): void {
  const cwd = process.cwd();
  const tracePath = findLatestTraceFile(cwd);

  if (!tracePath) {
    console.error(`no trace files found in ${cwd}`);
    process.exit(1);
  }

  // Read and process existing content
  const content = readFileSync(tracePath, "utf-8");
  for (const line of content.split("\n")) {
    processLine(line, runId, options?.layer, options?.direction, options?.raw ?? false);
  }

  // Follow mode: tail the file
  if (options?.follow) {
    const rl = readline.createInterface({
      input: createReadStream(tracePath, {
        start: statSync(tracePath).size,
      }),
    });

    rl.on("line", (line) => {
      processLine(line, runId, options.layer, options.direction, options.raw ?? false);
    });

    // Keep process alive
    process.on("SIGINT", () => {
      rl.close();
      process.exit(0);
    });
  }
}
