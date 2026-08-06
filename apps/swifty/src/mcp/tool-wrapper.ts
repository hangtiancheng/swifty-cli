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

import { createChildLogger } from "../logger/logger.js";
import type {
  MCPToolLike,
  ToolResult,
  ToolContext,
  ToolCategory,
  ToolSchema,
} from "../tools/types.js";

import type { MCPClient, MCPTool } from "./client.js";

import { asErrorString } from "@/utils/index.js";

const log = createChildLogger({ module: "mcp" });

/** MCP 工具名的公共前缀。 */
export const MCP_TOOL_PREFIX = "mcp__";
/**
 * 工具名里服务器段和工具段的分隔符。用双下划线是为了让边界可逆——服务器名和
 * 工具名自身允许带单下划线。
 */
export const MCP_NAME_SEP = "__";

/**
 * 把不合法字符换成下划线，保证拼出来的工具名能过 API 校验。
 *
 * 横杠虽然是 API 允许的字符，这里也一并换掉：Go 和 Python 版都是这么处理的，
 * 同一份 mcp_servers 配置在四个语言下必须算出同一个工具名，否则同一份
 * permissions.yaml 换个语言就匹配不上了。
 */
export function sanitizeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * 某个服务器下所有工具名的公共前缀。按服务器筛工具的地方都该用它，
 * 自己拼字符串会漏掉 sanitize。
 */
export function mcpToolNamePrefix(serverName: string): string {
  return MCP_TOOL_PREFIX + sanitizeSegment(serverName) + MCP_NAME_SEP;
}

export function buildMcpToolName(serverName: string, toolName: string): string {
  return mcpToolNamePrefix(serverName) + sanitizeSegment(toolName);
}

export class MCPToolWrapper implements MCPToolLike {
  name: string;
  description: string;
  category: ToolCategory = "command" as const;

  // MCP tools are lazily loaded by default to avoid cramming all schemas into the prompt

  deferred = true;
  mcpServerName: string;

  private client: MCPClient;
  private originalName: string;
  private inputSchema: ToolSchema["input_schema"];

  constructor(client: MCPClient, serverName: string, tool: MCPTool) {
    this.name = buildMcpToolName(serverName, tool.name);

    this.description = tool.description;
    this.originalName = tool.name;
    this.client = client;
    this.inputSchema = tool.inputSchema;
    this.mcpServerName = serverName;
  }

  /** 原始 JSON schema。mcp_call 的参数强转要按它逐层走。 */
  mcpInputSchema(): Record<string, unknown> {
    return this.inputSchema ?? {};
  }

  /** eager 模式下摘掉延迟标记，MCP 工具直接进 tools[]。 */
  setDeferLoading(on: boolean): void {
    this.deferred = on;
  }

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.inputSchema,
    };
  }

  async execute(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const { output, isError } = await this.client.callTool(this.originalName, args);
      return { output, isError };
    } catch (err) {
      log.error({ err }, "mcp operation failed");
      return {
        output: `MCP tool error: ${asErrorString(err)}`,
        isError: true,
      };
    }
  }
}
