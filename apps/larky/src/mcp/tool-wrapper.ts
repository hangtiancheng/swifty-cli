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

import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "mcp" });

import { asErrorString } from "@/utils/index.js";
import type { Tool, ToolResult, ToolContext, ToolCategory, ToolSchema } from "../tools/types.js";
import type { MCPClient, MCPTool } from "./client.js";

function sanitizeName(serverName: string, toolName: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${clean(serverName)}__${clean(toolName)}`;
}

export class MCPToolWrapper implements Tool {
  name: string;
  description: string;
  category: ToolCategory = "command" as const;

  // MCP tools are lazily loaded by default to avoid cramming all schemas into the prompt

  deferred = true;

  private client: MCPClient;
  private originalName: string;
  private inputSchema: ToolSchema["input_schema"];

  constructor(client: MCPClient, serverName: string, tool: MCPTool) {
    this.name = sanitizeName(serverName, tool.name);
    this.description = tool.description;
    this.originalName = tool.name;
    this.client = client;
    this.inputSchema = tool.inputSchema;
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
