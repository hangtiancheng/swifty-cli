#!/usr/bin/env tsx
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

/**
 * Generate PROTOCOL.md from zod schemas in larky bus modules.
 *
 * Usage:
 *   tsx scripts/gen-protocol-doc.ts
 *   tsx scripts/gen-protocol-doc.ts --check
 */
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  PingCommandSchema,
  PongResultSchema,
  CoreStatusCommandSchema,
  CoreStatusResultSchema,
  EventSubscribeCommandSchema,
  EventSubscribeResultSchema,
  SessionCreateCommandSchema,
  SessionCreateResultSchema,
  SessionListCommandSchema,
  SessionListResultSchema,
  SessionResumeCommandSchema,
  SessionResumeResultSchema,
  SessionSendMessageCommandSchema,
  SessionSendMessageResultSchema,
  SessionCloseCommandSchema,
  SessionCloseResultSchema,
  RunCancelCommandSchema,
  RunCancelResultSchema,
  PermissionRespondCommandSchema,
  PermissionRespondResultSchema,
  AskUserRespondCommandSchema,
  AskUserRespondResultSchema,
  PlanRespondCommandSchema,
  PlanRespondResultSchema,
  ModeSetCommandSchema,
  ModeSetResultSchema,
  CommandRunCommandSchema,
  CommandRunResultSchema,
  CommandListCommandSchema,
  CommandListResultSchema,
  RewindListCommandSchema,
  RewindListResultSchema,
  RewindApplyCommandSchema,
  RewindApplyResultSchema,
} from "../src/core/commands.js";
import { EventPushEnvelopeSchema } from "../src/core/envelope.js";
import { EventSchema } from "../src/core/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "PROTOCOL.md");

// Narrow an unknown value to Record<string, unknown> if it is a non-null object
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return true;
  }
  return false;
}

// Narrow an unknown value to string[] if it is an array
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [];
}

// Extract a printable string from an unknown value, falling back when the value
// would use Object's default toString (avoiding @typescript-eslint/no-base-to-string)
function asString(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

// Generate a Markdown section with field table and JSON Schema from a zod schema
function modelSection(name: string, schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema);
  const propsRaw: unknown = jsonSchema.properties;
  const props = isRecord(propsRaw) ? propsRaw : {};
  const required = new Set(asStringArray(jsonSchema.required));

  let table = "";
  if (Object.keys(props).length > 0) {
    table = "\n| Field | Type | Required |\n|---|---|---|\n";
    for (const [fieldName, fieldInfoRaw] of Object.entries(props)) {
      const fieldInfo = isRecord(fieldInfoRaw) ? fieldInfoRaw : {};
      let fieldType = asString(fieldInfo.type, "object");
      const anyOf = fieldInfo.anyOf;
      if (Array.isArray(anyOf)) {
        fieldType = anyOf
          .map((t: unknown) => asString(isRecord(t) ? t.type : "?", "?"))
          .join(" | ");
      }
      const req = required.has(fieldName) ? "yes" : "no";
      table += `| \`${fieldName}\` | \`${fieldType}\` | ${req} |\n`;
    }
  }

  const schemaBlock = `\n\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\`\n`;
  return `### ${name}\n${table}${schemaBlock}`;
}

// Extract the literal `type` value from an event/command option schema
function literalType(schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema);
  const props = isRecord(jsonSchema.properties) ? jsonSchema.properties : {};
  const typeInfo = props.type;
  if (isRecord(typeInfo)) {
    const enumVals = typeInfo.enum;
    if (Array.isArray(enumVals) && typeof enumVals[0] === "string") {
      return enumVals[0];
    }
    const constVal = typeInfo.const;
    if (typeof constVal === "string") {
      return constVal;
    }
    const defaultVal = typeInfo.default;
    if (typeof defaultVal === "string") {
      return defaultVal;
    }
  }
  return "unknown";
}

// RPC method → [request schema, result schema] pairs, in protocol order
const RPC_METHODS: [string, z.ZodType, z.ZodType][] = [
  ["core.ping", PingCommandSchema, PongResultSchema],
  ["core.status", CoreStatusCommandSchema, CoreStatusResultSchema],
  ["event.subscribe", EventSubscribeCommandSchema, EventSubscribeResultSchema],
  ["session.create", SessionCreateCommandSchema, SessionCreateResultSchema],
  ["session.list", SessionListCommandSchema, SessionListResultSchema],
  ["session.resume", SessionResumeCommandSchema, SessionResumeResultSchema],
  ["session.send_message", SessionSendMessageCommandSchema, SessionSendMessageResultSchema],
  ["session.close", SessionCloseCommandSchema, SessionCloseResultSchema],
  ["run.cancel", RunCancelCommandSchema, RunCancelResultSchema],
  ["permission.respond", PermissionRespondCommandSchema, PermissionRespondResultSchema],
  ["ask_user.respond", AskUserRespondCommandSchema, AskUserRespondResultSchema],
  ["plan.respond", PlanRespondCommandSchema, PlanRespondResultSchema],
  ["mode.set", ModeSetCommandSchema, ModeSetResultSchema],
  ["command.run", CommandRunCommandSchema, CommandRunResultSchema],
  ["command.list", CommandListCommandSchema, CommandListResultSchema],
  ["rewind.list", RewindListCommandSchema, RewindListResultSchema],
  ["rewind.apply", RewindApplyCommandSchema, RewindApplyResultSchema],
];

// Generate the complete PROTOCOL.md document string
function generate(): string {
  const sections: string[] = [
    "# Wire Protocol\n\n",
    "> Generated by `scripts/gen-protocol-doc.ts`. **Do not edit manually.**\n\n",
    "## Transport\n\n",
    "- TCP loopback `127.0.0.1:5520` (override via `LARKY_HOST` / `LARKY_PORT`)\n",
    "- Each message is one `\\n`-terminated JSON line (NDJSON)\n",
    "- Commands use JSON-RPC 2.0 (client → server); Events use `kind=event` envelope (server → client)\n",
    "- Interaction requests (`permission.requested`, `ask_user.requested`, `plan.requested`) carry an `id` that the client answers via the matching `*.respond` RPC\n\n",
    "## Commands\n\n",
    "All commands are sent as JSON-RPC 2.0 requests; `method` selects the handler.\n\n",
  ];

  for (const [method, reqSchema, resSchema] of RPC_METHODS) {
    sections.push(`## \`${method}\`\n\n`);
    sections.push(modelSection("Request params", reqSchema), "\n");
    sections.push(modelSection("Result", resSchema), "\n");
  }

  sections.push(
    "\n## Server Push\n\n",
    "Events pushed from daemon to subscribed clients over the same TCP connection.\n\n",
    modelSection("EventPushEnvelope", EventPushEnvelopeSchema),
    "\n## Events\n\n",
    "Events are written to the run's `events.jsonl` and forwarded over IPC to matching subscribers " +
      "(topic globs via picomatch; scope `global`, `session:<id>`, or `run:<id>`).\n\n",
  );

  for (const option of EventSchema.options) {
    sections.push(modelSection(`\`${literalType(option)}\``, option), "\n");
  }

  sections.push(
    "\n## Error Codes\n\n",
    "| Code | Name | Meaning |\n",
    "|------|------|---------|\n",
    "| -32700 | Parse Error | Invalid JSON received |\n",
    "| -32600 | Invalid Request | Missing required JSON-RPC fields |\n",
    "| -32601 | Method Not Found | Unknown method |\n",
    "| -32602 | Invalid Params | Parameter validation failed |\n",
    "| -32603 | Internal Error | Handler raised an unhandled exception |\n",
    "| -32010 | Session Not Found | Unknown session_id |\n",
    "| -32012 | Session Busy | A run is already in progress for this session |\n",
  );
  return sections.join("");
}

// Parse command-line arguments, write or verify PROTOCOL.md
function main(): void {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");

  const content = generate();

  if (isCheck) {
    try {
      const existing = readFileSync(OUTPUT_PATH, "utf-8");
      if (existing !== content) {
        console.error(
          `ERROR: ${OUTPUT_PATH} out of sync with code — run: tsx scripts/gen-protocol-doc.ts`,
        );
        process.exit(1);
      }
      console.log(`OK: ${OUTPUT_PATH} is up to date.`);
    } catch {
      console.error(`ERROR: ${OUTPUT_PATH} not found — run: tsx scripts/gen-protocol-doc.ts`);
      process.exit(1);
    }
  } else {
    writeFileSync(OUTPUT_PATH, content, "utf-8");
    console.log(`Generated ${OUTPUT_PATH}`);
  }
}

main();
