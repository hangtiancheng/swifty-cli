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
   * How MCP tools are loaded, written by mcp/strategy after connecting to the
   * server. ToolSearch relies on it to decide what to return, and the client
   * relies on it to decide whether to send defer_loading. It stays eager when
   * there is no MCP, which behaves the same as no deferral.
   */
  mcpLoadingMode: McpLoadingMode = "eager";

  /**
   * Whether to expose the search and dispatch tools to the model is computed once
   * by applyMode in mcp/strategy at session start. It is not recomputed each turn
   * based on "are there still deferred tools": tools may be disabled at runtime,
   * and recomputing would drop one from tools[] mid-session — that's an array
   * change, which breaks the cache prefix just the same.
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
    // The official endpoint uses native deferral: tools stay in tools[] but are
    // flagged with defer_loading, and the server decides whether to show them to
    // the model. This keeps the tools array byte-identical even when new tools are
    // discovered. Other endpoints can only hide deferred tools entirely and fall
    // back on mcp_call.
    const native = this.mcpLoadingMode === "native" && !isOpenAI;

    const schemas: (Anthropic.Tool | OpenAITool)[] = [];
    for (const tool of this.tools.values()) {
      // Only expose search and dispatch in modes where they're useful. In eager
      // mode there are no deferred tools to search and no need to dispatch; sending
      // both would only waste tokens and might tempt the model into a detour.
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
