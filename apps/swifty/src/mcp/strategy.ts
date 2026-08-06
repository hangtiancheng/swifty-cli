/**
 * 决定 MCP 工具怎么进上下文。三条路，会话启动连上 MCP 之后定一次：
 *
 *   eager    schema 总量不到上下文一成，全量放进 tools[]，不延迟。省下来的那点
 *            上下文不值得为它承担任何额外风险。
 *   native   官方 Anthropic 端点。工具带 defer_loading 留在 tools[] 里但服务端
 *            不给模型看，ToolSearch 回 tool_reference 让服务端展开 schema。
 *   dispatch 其他端点（国内厂商、各类代理网关）不支持上面两样，只能自己模拟：
 *            MCP 工具完全不进 tools[]，走 mcp_call 统一入口。
 *
 * 为什么要分这三条：tools 渲染在 system 之后、messages 之前，数组一变，它后面
 * 的整段对话历史缓存全部失效。实测两万 token 历史下，往 tools 末尾加一个工具
 * 的命中率从 99.4% 掉到 9.5%，等于把整段历史重算一遍。
 */

import type { ToolRegistry } from "../tools/registry.js";
import type { McpLoadingMode } from "../tools/types.js";

import { MCP_TOOL_PREFIX } from "./tool-wrapper.js";

import { isMcpToolLike } from "@/tools/mcp-call.js";

/** 低于上下文窗口这个比例就不延迟，直接全量加载。 */
export const DEFAULT_EAGER_THRESHOLD_PERCENT = 10;

/**
 * 拿不到真实 token 数时的估算比例。MCP 的 schema 是 JSON，符号密度高，每 token
 * 的字符数比自然语言低。
 */
export const CHARS_PER_TOKEN = 2.5;

/** 官方端点用的 beta header，defer_loading 和 tool_reference 都靠它开。 */
export const ADVANCED_TOOL_USE = "advanced-tool-use-2025-11-20";

const OFFICIAL_HOSTS = new Set(["api.anthropic.com"]);
const ENV_OVERRIDE = "SWIFTY_MCP_LOADING";

/** baseUrl 为空表示走 SDK 默认地址，也就是官方。 */
export function isOfficialAnthropicEndpoint(baseUrl: string): boolean {
  if (!baseUrl) {
    return true;
  }
  try {
    return OFFICIAL_HOSTS.has(new URL(baseUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function estimateSchemaTokens(schemaChars: number): number {
  return Math.floor(schemaChars / CHARS_PER_TOKEN);
}

export function decideMode(
  baseUrl: string,
  contextWindow: number,
  mcpSchemaChars: number,
  thresholdPercent = DEFAULT_EAGER_THRESHOLD_PERCENT,
): McpLoadingMode {
  const override = (process.env[ENV_OVERRIDE] ?? "").trim().toLowerCase();
  if (override === "eager" || override === "native" || override === "dispatch") {
    return override;
  }

  // 没有 MCP 工具，走哪条都一样，eager 最省事
  if (mcpSchemaChars <= 0) {
    return "eager";
  }

  const budget = (contextWindow * thresholdPercent) / 100;
  if (estimateSchemaTokens(mcpSchemaChars) < budget) {
    return "eager";
  }

  return isOfficialAnthropicEndpoint(baseUrl) ? "native" : "dispatch";
}

/** MCP 工具 schema 序列化后的字符数，用来跟阈值比。 */
export function measureSchemaChars(registry: ToolRegistry): number {
  let total = 0;
  for (const tool of registry.listTools()) {
    if (!tool.name.startsWith(MCP_TOOL_PREFIX)) {
      continue;
    }
    try {
      total += JSON.stringify(tool.schema()).length;
    } catch {
      total += tool.name.length + (tool.description?.length ?? 0);
    }
  }
  return total;
}

/**
 * 把决定落到 registry 上。
 *
 * eager 下要把 MCP 工具的延迟标记摘掉，它们才会出现在 tools[] 里；另外两条路
 * 保持延迟。mcp_call 不在这里注册——它必须在 MCP 连接之前就在 tools[] 里，
 * 否则连上之后再加就是一次中途改动 tools 数组，缓存照样断。
 */
export function applyMode(registry: ToolRegistry, mode: McpLoadingMode): void {
  registry.mcpLoadingMode = mode;
  const eager = mode === "eager";
  for (const tool of registry.listTools()) {
    if (isMcpToolLike(tool) && typeof tool.setDeferLoading === "function") {
      tool.setDeferLoading(!eager);
    }
  }

  // 检索和分发按模式决定发不发。eager 下所有工具都在 tools[] 里，没有可搜的
  // 对象、也不需要分发入口。这两个开关在这里算一次就固定下来，整场会话不变，
  // 不会造成 tools[] 中途抖动。
  registry.exposeToolSearch = !eager;
  registry.exposeMcpCall = mode === "dispatch";
}

/** 连上 MCP 之后调一次的入口。 */
export function decideAndApply(
  registry: ToolRegistry,
  baseUrl: string,
  contextWindow: number,
): McpLoadingMode {
  const mode = decideMode(baseUrl, contextWindow, measureSchemaChars(registry));
  applyMode(registry, mode);
  return mode;
}
