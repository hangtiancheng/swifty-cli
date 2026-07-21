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

// MCP log tools via SSE (corresponds to internal/ai/tools/query_log.go).
// Connects to the MCP server, lists tools, and wraps each as an AI SDK tool.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { tool, jsonSchema, type Tool } from "ai";
import { z } from "zod/v4";
import { config } from "@/lib/config";

let cachedClient: Client | null = null;
let cachedTools: Record<string, Tool> | null = null;

// MCP inputSchema comes back as an unknown object; validate it is a record
// before handing it to jsonSchema().
const mcpInputSchemaShape = z.record(z.string(), z.unknown());

export async function getLogMcpTools(): Promise<Record<string, Tool>> {
  if (cachedTools) return cachedTools;

  try {
    const transport = new SSEClientTransport(new URL(config.mcpUrl));
    const client = new Client({ name: "swifty-agent", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    cachedClient = client;

    const { tools } = await client.listTools();
    const result: Record<string, Tool> = {};
    for (const t of tools) {
      const toolName = t.name;
      const rawSchema = t.inputSchema ?? {};
      const inputSchema = mcpInputSchemaShape.parse(rawSchema);
      result[toolName] = tool({
        description: t.description ?? toolName,
        inputSchema: jsonSchema(inputSchema),
        execute: async (input) => {
          const args = z.record(z.string(), z.unknown()).parse(input);
          const res = await client.callTool({
            name: toolName,
            arguments: args,
          });
          return JSON.stringify(res.content);
        },
      });
    }

    cachedTools = result;
    return result;
  } catch (e) {
    // MCP server unavailable — degrade gracefully (mirrors Go: mcpTools, _ := GetLogMcpTool).
    console.warn(
      "[mcp] failed to connect, skipping log tools:",
      e instanceof Error ? e.message : e,
    );
    cachedTools = {};
    return cachedTools;
  }
}

export async function closeLogMcpClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedTools = null;
  }
}
