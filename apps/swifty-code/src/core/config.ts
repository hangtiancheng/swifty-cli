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

// Runtime config: 5-tier priority loading (defaults → ~/.swifty/config.toml → .swifty/config.toml → .env → env vars)
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import toml from "toml";
import { config as dotenvConfig } from "dotenv";

// Print config error message to stderr and exit with code 1 (matches Python SystemExit behavior)
function configExit(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ---- Defaults ----

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7437;
const DEFAULT_LOG_LEVEL = "INFO";
const DEFAULT_LOG_FILE = "~/.swifty/logs/core.log";
const DEFAULT_LOG_FORMAT = "text";
const DEFAULT_CONFIG_PATH = "~/.swifty/config.toml";
const DEFAULT_MAX_STEPS = 20;
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TRACE_FILE = "~/.swifty/traces/daemon.jsonl";

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

export interface SwiftyConfig {
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
function createDefaultConfig(): SwiftyConfig {
  return {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    logging: {
      level: DEFAULT_LOG_LEVEL,
      file: DEFAULT_LOG_FILE,
      format: DEFAULT_LOG_FORMAT,
    },
    agent: { maxSteps: DEFAULT_MAX_STEPS },
    llm: { defaultModel: DEFAULT_MODEL, router: "static" },
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
export function getConfig(): SwiftyConfig {
  const config = createDefaultConfig();

  // Load .env synchronously (does not overwrite existing env vars)
  loadDotenv();

  // Determine TOML config file paths
  const explicit = process.env["SWIFTY_CONFIG"];
  const configPaths = explicit
    ? [expandUser(explicit)]
    : [expandUser(DEFAULT_CONFIG_PATH), path.resolve(".swifty/config.toml")];

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

// Valid top-level TOML section names
const VALID_SECTIONS = new Set([
  "core",
  "logging",
  "agent",
  "llm",
  "trace",
  "permission",
  "compaction",
  "mcp",
]);

// Apply parsed TOML root table to config; throw on unknown sections or type errors
function applyToml(config: SwiftyConfig, data: Record<string, unknown>): void {
  const unknownKeys = Object.keys(data).filter((k) => !VALID_SECTIONS.has(k));
  if (unknownKeys.length > 0) {
    configExit(`Unknown top-level config keys: ${unknownKeys.sort().join(", ")}`);
  }

  if ("core" in data) {
    const core = data["core"];
    if (!isRecord(core)) {
      configExit("Config error: [core] must be a table");
    }
    const coreObj = core;
    const unknownCore = Object.keys(coreObj).filter((k) => !["host", "port"].includes(k));
    if (unknownCore.length > 0) {
      configExit(`Unknown [core] keys: ${unknownCore.sort().join(", ")}`);
    }
    if ("host" in coreObj) {
      if (typeof coreObj["host"] !== "string")
        configExit("Config error: core.host must be a string");
      config.host = coreObj["host"];
    }
    if ("port" in coreObj) {
      if (typeof coreObj["port"] !== "number")
        configExit("Config error: core.port must be an integer");
      config.port = coreObj["port"];
    }
  }

  if ("logging" in data) {
    const log = data["logging"];
    if (!isRecord(log)) {
      configExit("Config error: [logging] must be a table");
    }
    const logObj = log;
    const unknownLog = Object.keys(logObj).filter((k) => !["level", "file", "format"].includes(k));
    if (unknownLog.length > 0) {
      configExit(`Unknown [logging] keys: ${unknownLog.sort().join(", ")}`);
    }
    for (const key of ["level", "file", "format"] as const) {
      if (key in logObj) {
        if (typeof logObj[key] !== "string")
          configExit(`Config error: logging.${key} must be a string`);
        config.logging[key] = logObj[key];
      }
    }
  }

  if ("agent" in data) {
    const agent = data["agent"];
    if (!isRecord(agent)) {
      configExit("Config error: [agent] must be a table");
    }
    const agentObj = agent;
    const unknownAgent = Object.keys(agentObj).filter((k) => !["max_steps"].includes(k));
    if (unknownAgent.length > 0) {
      configExit(`Unknown [agent] keys: ${unknownAgent.sort().join(", ")}`);
    }
    if ("max_steps" in agentObj) {
      const val = agentObj["max_steps"];
      if (typeof val !== "number" || val <= 0) {
        configExit("Config error: agent.max_steps must be a positive integer");
      }
      config.agent.maxSteps = val;
    }
  }

  if ("llm" in data) {
    const llm = data["llm"];
    if (!isRecord(llm)) {
      configExit("Config error: [llm] must be a table");
    }
    const llmObj = llm;
    const unknownLlm = Object.keys(llmObj).filter((k) => !["default_model", "router"].includes(k));
    if (unknownLlm.length > 0) {
      configExit(`Unknown [llm] keys: ${unknownLlm.sort().join(", ")}`);
    }
    if ("default_model" in llmObj) {
      if (typeof llmObj["default_model"] !== "string")
        configExit("Config error: llm.default_model must be a string");
      config.llm.defaultModel = llmObj["default_model"];
    }
    if ("router" in llmObj) {
      if (typeof llmObj["router"] !== "string")
        configExit("Config error: llm.router must be a string");
      config.llm.router = llmObj["router"];
    }
  }

  if ("trace" in data) {
    const trace = data["trace"];
    if (!isRecord(trace)) {
      configExit("Config error: [trace] must be a table");
    }
    const traceObj = trace;
    const unknownTrace = Object.keys(traceObj).filter(
      (k) => !["enabled", "file", "include_llm_payload"].includes(k),
    );
    if (unknownTrace.length > 0) {
      configExit(`Unknown [trace] keys: ${unknownTrace.sort().join(", ")}`);
    }
    if ("enabled" in traceObj) {
      if (typeof traceObj["enabled"] !== "boolean")
        configExit("Config error: trace.enabled must be a boolean");
      config.trace.enabled = traceObj["enabled"];
    }
    if ("file" in traceObj) {
      if (typeof traceObj["file"] !== "string")
        configExit("Config error: trace.file must be a string");
      config.trace.file = traceObj["file"];
    }
    if ("include_llm_payload" in traceObj) {
      if (typeof traceObj["include_llm_payload"] !== "boolean")
        configExit("Config error: trace.include_llm_payload must be a boolean");
      config.trace.includeLlmPayload = traceObj["include_llm_payload"];
    }
  }

  if ("permission" in data) {
    const perm = data["permission"];
    if (!isRecord(perm)) {
      configExit("Config error: [permission] must be a table");
    }
    const permObj = perm;
    const unknownPerm = Object.keys(permObj).filter((k) => !["timeout_s"].includes(k));
    if (unknownPerm.length > 0) {
      configExit(`Unknown [permission] keys: ${unknownPerm.sort().join(", ")}`);
    }
    if ("timeout_s" in permObj) {
      const val = permObj["timeout_s"];
      if (typeof val !== "number" || val < 0) {
        configExit("Config error: permission.timeout_s must be a non-negative number");
      }
      config.permission.timeoutS = val;
    }
  }

  if ("compaction" in data) {
    const comp = data["compaction"];
    if (!isRecord(comp)) {
      configExit("Config error: [compaction] must be a table");
    }
    const compObj = comp;
    const unknownComp = Object.keys(compObj).filter(
      (k) => !["auto_threshold", "tool_result_limit", "tool_result_keep"].includes(k),
    );
    if (unknownComp.length > 0) {
      configExit(`Unknown [compaction] keys: ${unknownComp.sort().join(", ")}`);
    }
    if ("auto_threshold" in compObj) {
      const val = compObj["auto_threshold"];
      if (typeof val !== "number" || val < 0 || val > 1) {
        configExit("Config error: compaction.auto_threshold must be between 0 and 1");
      }
      config.compaction.autoThreshold = val;
    }
    if ("tool_result_limit" in compObj) {
      const val = compObj["tool_result_limit"];
      if (typeof val !== "number" || val <= 0) {
        configExit("Config error: compaction.tool_result_limit must be a positive integer");
      }
      config.compaction.toolResultLimit = val;
    }
    if ("tool_result_keep" in compObj) {
      const val = compObj["tool_result_keep"];
      if (typeof val !== "number" || val <= 0) {
        configExit("Config error: compaction.tool_result_keep must be a positive integer");
      }
      config.compaction.toolResultKeep = val;
    }
  }

  if ("mcp" in data) {
    const mcp = data["mcp"];
    if (!isRecord(mcp)) {
      configExit("Config error: [mcp] must be a table");
    }
    const mcpObj = mcp;
    const unknownMcp = Object.keys(mcpObj).filter((k) => !["servers"].includes(k));
    if (unknownMcp.length > 0) {
      configExit(`Unknown [mcp] keys: ${unknownMcp.sort().join(", ")}`);
    }
    const serversRaw = mcpObj["servers"] ?? [];
    if (!Array.isArray(serversRaw)) {
      configExit("Config error: mcp.servers must be an array of tables");
    }
    for (let i = 0; i < serversRaw.length; i++) {
      const srv: unknown = serversRaw[i];
      if (!isRecord(srv)) {
        configExit(`Config error: mcp.servers[${String(i)}] must be a table`);
      }
      const srvObj = srv;
      const name = srvObj["name"];
      if (typeof name !== "string" || !name) {
        configExit(`Config error: mcp.servers[${String(i)}].name must be a non-empty string`);
      }
      const transportRaw = srvObj["transport"];
      const transport = typeof transportRaw === "string" ? transportRaw : "stdio";
      if (transport !== "stdio" && transport !== "tcp") {
        configExit(`Config error: mcp.servers[${String(i)}].transport must be 'stdio' or 'tcp'`);
      }
      const s: McpServerConfig = {
        name,
        transport,
        command: "",
        args: [],
        env: {},
        host: "localhost",
        port: 3000,
      };
      if ("command" in srvObj) {
        if (typeof srvObj["command"] !== "string")
          configExit(`Config error: mcp.servers[${String(i)}].command must be a string`);
        s.command = srvObj["command"];
      }
      if ("args" in srvObj) {
        if (!Array.isArray(srvObj["args"]))
          configExit(`Config error: mcp.servers[${String(i)}].args must be an array`);
        const argsRaw: unknown = srvObj["args"];
        s.args = Array.isArray(argsRaw) ? argsRaw.map(String) : [];
      }
      if ("env" in srvObj) {
        const envVal = srvObj["env"];
        if (!isRecord(envVal)) {
          configExit(`Config error: mcp.servers[${String(i)}].env must be a table`);
        }
        s.env = Object.fromEntries(Object.entries(envVal).map(([k, v]) => [k, String(v)]));
      }
      if ("host" in srvObj) {
        if (typeof srvObj["host"] !== "string")
          configExit(`Config error: mcp.servers[${String(i)}].host must be a string`);
        s.host = srvObj["host"];
      }
      if ("port" in srvObj) {
        if (typeof srvObj["port"] !== "number")
          configExit(`Config error: mcp.servers[${String(i)}].port must be an integer`);
        s.port = srvObj["port"];
      }
      config.mcp.servers.push(s);
    }
  }
}

// Override config fields from SWIFTY_* environment variables
function applyEnv(config: SwiftyConfig): void {
  const host = process.env["SWIFTY_HOST"];
  if (host !== undefined) config.host = host;

  const portStr = process.env["SWIFTY_PORT"];
  if (portStr !== undefined) {
    const port = Number(portStr);
    if (!Number.isInteger(port)) {
      configExit(`Config error: SWIFTY_PORT must be an integer, got: ${JSON.stringify(portStr)}`);
    }
    config.port = port;
  }

  const logLevel = process.env["SWIFTY_LOG_LEVEL"];
  if (logLevel !== undefined) config.logging.level = logLevel;

  const logFile = process.env["SWIFTY_LOG_FILE"];
  if (logFile !== undefined) config.logging.file = logFile;

  const logFormat = process.env["SWIFTY_LOG_FORMAT"];
  if (logFormat !== undefined) config.logging.format = logFormat;

  const maxStepsStr = process.env["SWIFTY_MAX_STEPS"];
  if (maxStepsStr !== undefined) {
    const val = Number(maxStepsStr);
    if (!Number.isInteger(val) || val <= 0) {
      configExit(
        `Config error: SWIFTY_MAX_STEPS must be a positive integer, got: ${JSON.stringify(maxStepsStr)}`,
      );
    }
    config.agent.maxSteps = val;
  }

  const defaultModel = process.env["SWIFTY_LLM_DEFAULT_MODEL"];
  if (defaultModel !== undefined) config.llm.defaultModel = defaultModel;

  const traceEnabled = process.env["SWIFTY_TRACE_ENABLED"];
  if (traceEnabled !== undefined) {
    config.trace.enabled = !["0", "false", "no"].includes(traceEnabled.toLowerCase());
  }

  const traceFile = process.env["SWIFTY_TRACE_FILE"];
  if (traceFile !== undefined) config.trace.file = traceFile;

  const tracePayload = process.env["SWIFTY_TRACE_INCLUDE_LLM_PAYLOAD"];
  if (tracePayload !== undefined) {
    config.trace.includeLlmPayload = !["0", "false", "no"].includes(tracePayload.toLowerCase());
  }

  const permTimeout = process.env["SWIFTY_PERMISSION_TIMEOUT_S"];
  if (permTimeout !== undefined) {
    const val = Number(permTimeout);
    if (Number.isNaN(val) || val < 0) {
      configExit(
        `Config error: SWIFTY_PERMISSION_TIMEOUT_S must be >= 0, got: ${JSON.stringify(permTimeout)}`,
      );
    }
    config.permission.timeoutS = val;
  }

  const compactThreshold = process.env["SWIFTY_COMPACT_THRESHOLD"];
  if (compactThreshold !== undefined) {
    const val = Number(compactThreshold);
    if (Number.isNaN(val) || val < 0 || val > 1) {
      configExit(
        `Config error: SWIFTY_COMPACT_THRESHOLD must be between 0 and 1, got: ${JSON.stringify(compactThreshold)}`,
      );
    }
    config.compaction.autoThreshold = val;
  }

  const compactToolLimit = process.env["SWIFTY_COMPACT_TOOL_LIMIT"];
  if (compactToolLimit !== undefined) {
    const val = Number(compactToolLimit);
    if (!Number.isInteger(val) || val <= 0) {
      configExit(
        `Config error: SWIFTY_COMPACT_TOOL_LIMIT must be a positive integer, got: ${JSON.stringify(compactToolLimit)}`,
      );
    }
    config.compaction.toolResultLimit = val;
  }

  const compactToolKeep = process.env["SWIFTY_COMPACT_TOOL_KEEP"];
  if (compactToolKeep !== undefined) {
    const val = Number(compactToolKeep);
    if (!Number.isInteger(val) || val <= 0) {
      configExit(
        `Config error: SWIFTY_COMPACT_TOOL_KEEP must be a positive integer, got: ${JSON.stringify(compactToolKeep)}`,
      );
    }
    config.compaction.toolResultKeep = val;
  }
}
