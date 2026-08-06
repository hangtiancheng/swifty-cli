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

import { MCP_TOOL_PREFIX } from "../mcp/tool-wrapper.js";
import { intArg, strArg } from "../utils/index.js";

import type { ToolRegistry } from "./registry.js";
import { TOOL_SEARCH_TOOL_NAME } from "./tool-names.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";

export class ToolSearchTool implements Tool {
  name = TOOL_SEARCH_TOOL_NAME;

  description = "Search for and load deferred tools by name or keyword.";
  category: ToolCategory = "read";

  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        query: {
          type: "string" as const,
          description:
            'Search query. Use "select:name1,name2" to load specific tools by name, or keywords to search.',
        },
        max_results: {
          type: "integer" as const,
          description: "Max results to return",
          default: 5,
        },
      },
      required: ["query"],
    };
    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const query = strArg(args, "query");
    const maxResults = intArg(args, "max_results", 5);

    if (!query) {
      return Promise.resolve({
        output: "Error: query is required",
        isError: true,
      });
    }
    // Handle "select:name1,name2" syntax
    if (query.startsWith("select:")) {
      const names = query
        .slice("select:".length)
        .split(",")
        .map((n) => n.trim());
      const tools = this.registry.findDeferredByNames(names);
      if (tools.length === 0) {
        return Promise.resolve({
          output: `No deferred tools found matching: ${names.join(", ")}`,
          isError: false,
        });
      }
      // 非 MCP 的延迟工具没有 mcp_call 这条入口，只能照旧标记成已发现、让它进
      // 下一轮的 tools[]
      const mcpNames: string[] = [];
      for (const t of tools) {
        if (t.name.startsWith(MCP_TOOL_PREFIX)) {
          mcpNames.push(t.name);
        } else {
          this.registry.markDiscovered(t.name);
        }
      }

      // 官方端点：回 tool_reference，让服务端把 schema 展开进上下文。tools 数组
      // 不动，缓存前缀因此不断。
      if (mcpNames.length > 0 && this.registry.mcpLoadingMode === "native") {
        return Promise.resolve({
          output:
            `Loaded ${String(mcpNames.length)} tool(s): ${mcpNames.join(", ")}. ` +
            "You can call them directly now.",
          isError: false,
          contentBlocks: mcpNames.map((name) => ({
            type: "tool_reference",
            tool_name: name,
          })),
        });
      }

      // 其他端点：schema 原文给模型看，调用走 mcp_call。这段文本落在 messages
      // 末尾，属于追加，不影响缓存前缀。
      const schemas = tools.map((t) => JSON.stringify(t.schema(), null, 2));
      const suffix =
        mcpNames.length > 0
          ? "\n\nTo invoke any of the tools above, call mcp_call with that tool's " +
            "full name and an `arguments` object matching its input_schema exactly, " +
            "using the same JSON types."
          : "";
      return Promise.resolve({
        output: schemas.join("\n\n") + suffix,
        isError: false,
      });
    }

    // Keyword search
    const tools = this.registry.searchDeferred(query, maxResults);
    if (tools.length === 0) {
      return Promise.resolve({
        output: "No deferred tools matched the query.",
        isError: false,
      });
    }

    const schemas = tools.map((t) => JSON.stringify(t.schema(), null, 2));
    return Promise.resolve({
      output: schemas.join("\n\n"),
      isError: false,
    });
  }
}
