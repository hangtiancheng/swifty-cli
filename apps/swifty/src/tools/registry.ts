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

import type Anthropic from "@anthropic-ai/sdk";
import type { FunctionTool as OpenAITool } from "openai/resources/responses/responses";

import { MCP_CALL_TOOL_NAME, TOOL_SEARCH_TOOL_NAME } from "./tool-names.js";
import type { McpLoadingMode, Tool } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private discovered = new Set<string>();

  /**
   * MCP 工具的加载方式，由 mcp/strategy 在连上服务器后写入。ToolSearch 靠它
   * 决定回什么、client 靠它决定要不要发 defer_loading。没有 MCP 时保持 eager，
   * 行为等同于不延迟。
   */
  mcpLoadingMode: McpLoadingMode = "eager";

  /**
   * 检索和分发这两个工具发不发给模型，由 mcp/strategy 的 applyMode 在会话启动
   * 时算一次。不每轮按「当前还有没有延迟工具」现算：工具可能被运行时禁用，
   * 现算会让 tools[] 中途少一个，那就是一次数组变动，缓存前缀照样断。
   */
  exposeToolSearch = false;
  exposeMcpCall = false;

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  listTools(): Tool[] {
    return [...this.tools.values()];
  }

  getAllSchemas(protocol?: "anthropic"): Anthropic.Tool[];
  getAllSchemas(protocol: "openai" | "openai-compat"): OpenAITool[];
  getAllSchemas(
    protocol: "anthropic" | "openai" | "openai-compat" = "anthropic",
  ): (Anthropic.Tool | OpenAITool)[] {
    const isOpenAI = protocol === "openai" || protocol === "openai-compat";
    // 官方端点走原生延迟：工具留在 tools[] 里但打上 defer_loading，由服务端决定
    // 给不给模型看。这样即使发现了新工具，tools 数组的字节也不变。其他端点只能
    // 把延迟工具整个藏起来，靠 mcp_call 兜。
    const native = this.mcpLoadingMode === "native" && !isOpenAI;

    const schemas: (Anthropic.Tool | OpenAITool)[] = [];
    for (const tool of this.tools.values()) {
      // 检索和分发只在用得上的模式里发。eager 下没有延迟工具可搜、也不需要
      // 分发，两个都发过去只是白占 token，还可能引诱模型去绕一圈。
      if (
        (tool.name === TOOL_SEARCH_TOOL_NAME && !this.exposeToolSearch) ||
        (tool.name === MCP_CALL_TOOL_NAME && !this.exposeMcpCall)
      ) {
        continue;
      }
      const deferred = Boolean(tool.deferred) && !this.discovered.has(tool.name);
      if (deferred && !native) {
        continue;
      }
      const s = tool.schema();
      if (isOpenAI) {
        // openai and openai-compat both use FunctionTool shape
        schemas.push({
          strict: false, // Whether to enforce strict parameter validation. Default true.
          type: "function",
          name: s.name,
          description: s.description,
          parameters: s.input_schema,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          function: {
            name: s.name,
            description: s.description,
            parameters: s.input_schema,
          },
        } satisfies OpenAITool);
      } else {
        schemas.push(
          deferred
            ? ({
                ...s,
                type: "custom",
                defer_loading: true,
              } satisfies Anthropic.Tool)
            : ({
                ...s,
                type: "custom",
              } satisfies Anthropic.Tool),
        );
      }
    }
    return schemas;
  }

  getDeferredToolNames(): string[] {
    const names: string[] = [];
    for (const tool of this.tools.values()) {
      if (tool.deferred && !this.discovered.has(tool.name)) {
        names.push(tool.name);
      }
    }
    return names;
  }

  getDeferredTools(): Tool[] {
    return [...this.tools.values()].filter((t) => t.deferred && !this.discovered.has(t.name));
  }

  searchDeferred(query: string, maxResults = 5): Tool[] {
    const lower = query.toLowerCase();
    const matches: Tool[] = [];
    for (const tool of this.tools.values()) {
      if (!tool.deferred || this.discovered.has(tool.name)) {
        continue;
      }
      if (
        tool.name.toLowerCase().includes(lower) ||
        tool.description.toLowerCase().includes(lower)
      ) {
        matches.push(tool);
        if (matches.length >= maxResults) {
          break;
        }
      }
    }
    return matches;
  }

  findDeferredByNames(names: string[]): Tool[] {
    // Case-insensitive name matching
    const lowerMap = new Map<string, Tool>();
    for (const [name, tool] of this.tools) {
      lowerMap.set(name.toLowerCase(), tool);
    }
    return names
      .map((n) => lowerMap.get(n.toLowerCase()))
      .filter((t): t is Tool => t?.deferred ?? false);
  }

  markDiscovered(name: string): void {
    this.discovered.add(name);
  }

  isDiscovered(name: string): boolean {
    return this.discovered.has(name);
  }
}
