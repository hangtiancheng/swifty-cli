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

// Runtime config: 5-tier priority loading (defaults → ~/.larky/config.toml → .larky/config.toml → .env → env vars)
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import toml from "toml";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

// Print config error message to stderr and exit with code 1 (matches Python SystemExit behavior)
function configExit(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ---- Defaults ----

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5520;
const DEFAULT_LOG_LEVEL = "INFO";
const DEFAULT_LOG_FILE = "~/.larky/logs/core.log";
const DEFAULT_LOG_FORMAT = "text";
const DEFAULT_CONFIG_PATH = "~/.larky/config.toml";
const DEFAULT_MAX_STEPS = 20;
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TRACE_FILE = "~/.larky/traces/daemon.jsonl";

// ---- Config sub-structures ----

export interface LoggingConfig {
  level: string;
  file: string;
  format: string;
}

export interface AgentConfig {
  maxSteps: number;
}

export interface LlmConfig {
  defaultModel: string;
  router: string;
  baseUrl: string;
  apiKey: string;
}

export interface TraceConfig {
  enabled: boolean;
  file: string;
  includeLlmPayload: boolean;
}

export interface PermissionConfig {
  timeoutS: number;
}

export interface CompactionConfig {
  autoThreshold: number;
  toolResultLimit: number;
  toolResultKeep: number;
}

export interface McpServerConfig {
  name: string;
  transport: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  host: string;
  port: number;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

export interface LarkyConfig {
  host: string;
  port: number;
  logging: LoggingConfig;
  agent: AgentConfig;
  llm: LlmConfig;
  trace: TraceConfig;
  permission: PermissionConfig;
  compaction: CompactionConfig;
  mcp: McpConfig;
}

// Create default config
function createDefaultConfig(): LarkyConfig {
  return {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    logging: {
      level: DEFAULT_LOG_LEVEL,
      file: DEFAULT_LOG_FILE,
      format: DEFAULT_LOG_FORMAT,
    },
    agent: { maxSteps: DEFAULT_MAX_STEPS },
    llm: { defaultModel: DEFAULT_MODEL, router: "static", baseUrl: "", apiKey: "" },
    trace: { enabled: true, file: DEFAULT_TRACE_FILE, includeLlmPayload: true },
    permission: { timeoutS: 60.0 },
    compaction: {
      autoThreshold: 0.0,
      toolResultLimit: 8000,
      toolResultKeep: 4000,
    },
    mcp: { servers: [] },
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

// Build and return runtime config: defaults → global TOML → local TOML → .env → env vars
export function getConfig(): LarkyConfig {
  const config = createDefaultConfig();

  // Load .env synchronously (does not overwrite existing env vars)
  loadDotenv();

  // Determine TOML config file paths
  const explicit = process.env["LARKY_CONFIG"];
  const configPaths = explicit
    ? [expandUser(explicit)]
    : [expandUser(DEFAULT_CONFIG_PATH), path.resolve(".larky/config.toml")];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8");
        const parsed: unknown = toml.parse(content);
        const data = isRecord(parsed) ? parsed : {};
        applyToml(config, data);
      } catch (e) {
        configExit(`Config parse error (${configPath}): ${String(e)}`);
      }
    }
  }

  applyEnv(config);
  return config;
}

// Load .env file using dotenv package (does not overwrite existing env vars)
function loadDotenv(): void {
  dotenvConfig({ override: false });
}

// ---- TOML schema (zod) ----
// Every section and key is optional; unknown sections or keys are fatal
// (strictObject). Constraint violations are reported via configExit.

const CoreSectionSchema = z.strictObject({
  host: z.string().optional(),
  port: z.number().int().optional(),
});

const LoggingSectionSchema = z.strictObject({
  level: z.string().optional(),
  file: z.string().optional(),
  format: z.string().optional(),
});

const AgentSectionSchema = z.strictObject({
  max_steps: z.number().positive("must be a positive integer").optional(),
});

const LlmSectionSchema = z.strictObject({
  default_model: z.string().optional(),
  router: z.string().optional(),
  base_url: z.string().optional(),
  api_key: z.string().optional(),
});

const TraceSectionSchema = z.strictObject({
  enabled: z.boolean().optional(),
  file: z.string().optional(),
  include_llm_payload: z.boolean().optional(),
});

const PermissionSectionSchema = z.strictObject({
  timeout_s: z.number().min(0, "must be a non-negative number").optional(),
});

const CompactionSectionSchema = z.strictObject({
  auto_threshold: z
    .number()
    .min(0, "must be between 0 and 1")
    .max(1, "must be between 0 and 1")
    .optional(),
  tool_result_limit: z.number().positive("must be a positive integer").optional(),
  tool_result_keep: z.number().positive("must be a positive integer").optional(),
});

const McpServerSchema = z.strictObject({
  name: z.string().min(1, "must be a non-empty string"),
  transport: z.enum(["stdio", "tcp"], "must be 'stdio' or 'tcp'").default("stdio"),
  command: z.string().default(""),
  args: z.array(z.coerce.string()).default([]),
  env: z.record(z.string(), z.coerce.string()).default({}),
  host: z.string().default("localhost"),
  port: z.number().int().default(3000),
});

const McpSectionSchema = z.strictObject({
  servers: z.array(McpServerSchema).default([]),
});

const TomlConfigSchema = z.strictObject({
  core: CoreSectionSchema.optional(),
  logging: LoggingSectionSchema.optional(),
  agent: AgentSectionSchema.optional(),
  llm: LlmSectionSchema.optional(),
  trace: TraceSectionSchema.optional(),
  permission: PermissionSectionSchema.optional(),
  compaction: CompactionSectionSchema.optional(),
  mcp: McpSectionSchema.optional(),
});

// Render a zod issue in the established config error style
// ("Unknown ... keys" for unrecognized keys, "Config error: <path>: <reason>" otherwise)
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

// Validate parsed TOML root table against the schema and merge it into config;
// exits with an error message on unknown keys or type/constraint violations
function applyToml(config: LarkyConfig, data: Record<string, unknown>): void {
  const result = TomlConfigSchema.safeParse(data);
  if (!result.success) {
    configExit(result.error.issues.map(formatIssue).join("\n"));
  }
  const t = result.data;

  if (t.core?.host !== undefined) config.host = t.core.host;
  if (t.core?.port !== undefined) config.port = t.core.port;

  if (t.logging?.level !== undefined) config.logging.level = t.logging.level;
  if (t.logging?.file !== undefined) config.logging.file = t.logging.file;
  if (t.logging?.format !== undefined) config.logging.format = t.logging.format;

  if (t.agent?.max_steps !== undefined) config.agent.maxSteps = t.agent.max_steps;

  if (t.llm?.default_model !== undefined) config.llm.defaultModel = t.llm.default_model;
  if (t.llm?.router !== undefined) config.llm.router = t.llm.router;
  if (t.llm?.base_url !== undefined) config.llm.baseUrl = t.llm.base_url;
  if (t.llm?.api_key !== undefined) config.llm.apiKey = t.llm.api_key;

  if (t.trace?.enabled !== undefined) config.trace.enabled = t.trace.enabled;
  if (t.trace?.file !== undefined) config.trace.file = t.trace.file;
  if (t.trace?.include_llm_payload !== undefined)
    config.trace.includeLlmPayload = t.trace.include_llm_payload;

  if (t.permission?.timeout_s !== undefined) config.permission.timeoutS = t.permission.timeout_s;

  if (t.compaction?.auto_threshold !== undefined)
    config.compaction.autoThreshold = t.compaction.auto_threshold;
  if (t.compaction?.tool_result_limit !== undefined)
    config.compaction.toolResultLimit = t.compaction.tool_result_limit;
  if (t.compaction?.tool_result_keep !== undefined)
    config.compaction.toolResultKeep = t.compaction.tool_result_keep;

  if (t.mcp) {
    config.mcp.servers.push(...t.mcp.servers);
  }
}

// Override config fields from LARKY_* environment variables
function applyEnv(config: LarkyConfig): void {
  const host = process.env["LARKY_HOST"];
  if (host !== undefined) config.host = host;

  const portStr = process.env["LARKY_PORT"];
  if (portStr !== undefined) {
    const port = Number(portStr);
    if (!Number.isInteger(port)) {
      configExit(`Config error: LARKY_PORT must be an integer, got: ${JSON.stringify(portStr)}`);
    }
    config.port = port;
  }

  const logLevel = process.env["LARKY_LOG_LEVEL"];
  if (logLevel !== undefined) config.logging.level = logLevel;

  const logFile = process.env["LARKY_LOG_FILE"];
  if (logFile !== undefined) config.logging.file = logFile;

  const logFormat = process.env["LARKY_LOG_FORMAT"];
  if (logFormat !== undefined) config.logging.format = logFormat;

  const maxStepsStr = process.env["LARKY_MAX_STEPS"];
  if (maxStepsStr !== undefined) {
    const val = Number(maxStepsStr);
    if (!Number.isInteger(val) || val <= 0) {
      configExit(
        `Config error: LARKY_MAX_STEPS must be a positive integer, got: ${JSON.stringify(maxStepsStr)}`,
      );
    }
    config.agent.maxSteps = val;
  }

  const defaultModel = process.env["LARKY_LLM_DEFAULT_MODEL"];
  if (defaultModel !== undefined) config.llm.defaultModel = defaultModel;

  const anthropicBaseUrl = process.env["ANTHROPIC_BASE_URL"];
  if (anthropicBaseUrl !== undefined) config.llm.baseUrl = anthropicBaseUrl;

  const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
  if (anthropicApiKey !== undefined) config.llm.apiKey = anthropicApiKey;

  const traceEnabled = process.env["LARKY_TRACE_ENABLED"];
  if (traceEnabled !== undefined) {
    config.trace.enabled = !["0", "false", "no"].includes(traceEnabled.toLowerCase());
  }

  const traceFile = process.env["LARKY_TRACE_FILE"];
  if (traceFile !== undefined) config.trace.file = traceFile;

  const tracePayload = process.env["LARKY_TRACE_INCLUDE_LLM_PAYLOAD"];
  if (tracePayload !== undefined) {
    config.trace.includeLlmPayload = !["0", "false", "no"].includes(tracePayload.toLowerCase());
  }

  const permTimeout = process.env["LARKY_PERMISSION_TIMEOUT_S"];
  if (permTimeout !== undefined) {
    const val = Number(permTimeout);
    if (Number.isNaN(val) || val < 0) {
      configExit(
        `Config error: LARKY_PERMISSION_TIMEOUT_S must be >= 0, got: ${JSON.stringify(permTimeout)}`,
      );
    }
    config.permission.timeoutS = val;
  }

  const compactThreshold = process.env["LARKY_COMPACT_THRESHOLD"];
  if (compactThreshold !== undefined) {
    const val = Number(compactThreshold);
    if (Number.isNaN(val) || val < 0 || val > 1) {
      configExit(
        `Config error: LARKY_COMPACT_THRESHOLD must be between 0 and 1, got: ${JSON.stringify(compactThreshold)}`,
      );
    }
    config.compaction.autoThreshold = val;
  }

  const compactToolLimit = process.env["LARKY_COMPACT_TOOL_LIMIT"];
  if (compactToolLimit !== undefined) {
    const val = Number(compactToolLimit);
    if (!Number.isInteger(val) || val <= 0) {
      configExit(
        `Config error: LARKY_COMPACT_TOOL_LIMIT must be a positive integer, got: ${JSON.stringify(compactToolLimit)}`,
      );
    }
    config.compaction.toolResultLimit = val;
  }

  const compactToolKeep = process.env["LARKY_COMPACT_TOOL_KEEP"];
  if (compactToolKeep !== undefined) {
    const val = Number(compactToolKeep);
    if (!Number.isInteger(val) || val <= 0) {
      configExit(
        `Config error: LARKY_COMPACT_TOOL_KEEP must be a positive integer, got: ${JSON.stringify(compactToolKeep)}`,
      );
    }
    config.compaction.toolResultKeep = val;
  }
}
