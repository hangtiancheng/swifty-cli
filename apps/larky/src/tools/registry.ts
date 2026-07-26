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
import type { Tool } from "./types.js";
import type { FunctionTool as OpenAITool } from "openai/resources/responses/responses";

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private discovered = new Set<string>();

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
    const result: (Anthropic.Tool | OpenAITool)[] = [];
    for (const tool of this.tools.values()) {
      if (tool.deferred && !this.discovered.has(tool.name)) {
        continue;
      }
      const s = tool.schema();
      if (protocol === "anthropic") {
        result.push({
          name: s.name,
          description: s.description,
          input_schema: {
            type: "object",
            properties: s.input_schema.properties,
            required: s.input_schema.required ?? [],
          },
        });
      } else {
        // openai and openai-compat both use FunctionTool shape
        result.push({
          strict: false, // Whether to enforce strict parameter validation. Default true.
          type: "function",
          name: s.name,
          description: s.description,
          parameters: s.input_schema,
        });
      }
    }
    return result;
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
