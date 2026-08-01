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

// Runtime config: 3-tier priority loading (defaults → ~/.larky/config.yaml → .larky/config.yaml)
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import yaml from "js-yaml";
import { z } from "zod";

// Print config error message to stderr and exit with code 1
function configExit(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ---- Defaults ----

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5520;
const DEFAULT_TRACE_FILE = "~/.larky/traces/daemon.jsonl";

// ---- Config sub-structures ----

export interface TraceConfig {
  enable: boolean;
  file: string;
}

export interface LarkyConfig {
  host: string;
  port: number;
  trace: TraceConfig;
}

// Create default config
function createDefaultConfig(): LarkyConfig {
  return {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    trace: { enable: true, file: DEFAULT_TRACE_FILE },
  };
}

// Replace ~ with user home directory
export function expandUser(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

// Type guard: check if value is a plain object (not null, not array)
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Build and return runtime config: defaults → global YAML → local YAML
export function getConfig(): LarkyConfig {
  const config = createDefaultConfig();

  const configPaths = [expandUser("~/.larky/config.yaml"), path.resolve(".larky/config.yaml")];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8");
        const parsed: unknown = yaml.load(content);
        const data = isRecord(parsed) ? parsed : {};
        applyFileConfig(config, data);
      } catch (e) {
        configExit(`Config parse error (${configPath}): ${String(e)}`);
      }
    }
  }

  return config;
}

// ---- YAML schema (zod) ----
// Top-level uses looseObject so AppConfig keys (providers, hooks, …) are
// silently ignored. Section schemas remain strict to catch typos.

const CoreSectionSchema = z.strictObject({
  host: z.string().optional(),
  port: z.number().int().optional(),
});

const TraceSectionSchema = z.strictObject({
  enable: z.boolean().optional(),
  file: z.string().optional(),
});

const FileConfigSchema = z.looseObject({
  core: CoreSectionSchema.optional(),
  trace: TraceSectionSchema.optional(),
});

// Render a zod issue in the established config error style
function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String);
  if (issue.code === "unrecognized_keys") {
    const keys = [...issue.keys].sort().join(", ");
    return path.length === 0
      ? `Unknown top-level config keys: ${keys}`
      : `Unknown [${path.join(".")}] keys: ${keys}`;
  }
  const where = path.length > 0 ? `${path.join(".")}: ` : "";
  return `Config error: ${where}${issue.message}`;
}

// Validate parsed YAML against the schema and merge it into config;
// exits with an error message on type/constraint violations within known sections
function applyFileConfig(config: LarkyConfig, data: Record<string, unknown>): void {
  const result = FileConfigSchema.safeParse(data);
  if (!result.success) {
    configExit(result.error.issues.map(formatIssue).join("\n"));
  }
  const t = result.data;

  if (t.core?.host !== undefined) {
    config.host = t.core.host;
  }
  if (t.core?.port !== undefined) {
    config.port = t.core.port;
  }

  if (t.trace?.enable !== undefined) {
    config.trace.enable = t.trace.enable;
  }
  if (t.trace?.file !== undefined) {
    config.trace.file = t.trace.file;
  }
}
