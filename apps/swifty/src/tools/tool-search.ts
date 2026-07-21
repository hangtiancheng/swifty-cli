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

import type { ToolRegistry } from "./registry.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";
import { intArg, strArg } from "../utils/index.js";

export class ToolSearchTool implements Tool {
  name = "ToolSearch";
  description = "Search for and load deferred tools by name or keyword.";
  category: ToolCategory = "read";
  system = true;

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
      for (const t of tools) {
        this.registry.markDiscovered(t.name);
      }
      if (tools.length === 0) {
        return Promise.resolve({
          output: `No deferred tools found matching: ${names.join(", ")}`,
          isError: false,
        });
      }
      const schemas = tools.map((t) => JSON.stringify(t.schema(), null, 2));
      return Promise.resolve({
        output: schemas.join("\n\n"),
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
