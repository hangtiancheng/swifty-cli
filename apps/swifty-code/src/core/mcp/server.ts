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

// McpServerManager: lifecycle management for MCP server connections
// Connects each configured server, discovers tools, and provides them for registry injection
import type { McpServerConfig } from "../config.js";
import { McpClient } from "./client.js";
import { McpTool } from "./tool.js";

export class McpServerManager {
  private _clients = new Map<string, McpClient>();
  private _tools: McpTool[] = [];

  // Connect each MCP server sequentially, discover tools, and cache for registry use
  // Failed servers are logged and skipped — the agent remains functional without them
  async startAll(servers: McpServerConfig[]): Promise<void> {
    for (const cfg of servers) {
      try {
        const client = await this._connect(cfg);
        const toolDefs = await client.listTools();
        for (const toolDef of toolDefs) {
          this._tools.push(new McpTool(client, cfg.name, toolDef));
        }
        this._clients.set(cfg.name, client);
        console.info(
          `mcp: server '${cfg.name}' connected, ${String(toolDefs.length)} tool(s) discovered`,
        );
      } catch (exc) {
        console.error(`mcp: server '${cfg.name}' failed to start, skipping`, exc);
      }
    }
  }

  // Return discovered MCP tools for injection into ToolRegistry per-run
  getTools(): McpTool[] {
    return [...this._tools];
  }

  // Gracefully close all MCP connections and terminate stdio subprocesses
  async stopAll(): Promise<void> {
    for (const [name, client] of this._clients) {
      try {
        await client.close();
        console.info(`mcp: server '${name}' closed`);
      } catch (exc) {
        console.warn(`mcp: error closing server '${name}'`, exc);
      }
    }
    this._clients.clear();
    this._tools = [];
  }

  // Establish connection based on transport type
  private async _connect(cfg: McpServerConfig): Promise<McpClient> {
    const client = new McpClient();
    if (cfg.transport === "stdio") {
      if (!cfg.command) {
        throw new Error(`mcp server '${cfg.name}': stdio transport requires 'command'`);
      }
      await client.connectStdio(cfg.command, cfg.args, cfg.env);
    } else if (cfg.transport === "tcp") {
      await client.connectTcp(cfg.host, cfg.port);
    } else {
      throw new Error(`mcp server '${cfg.name}': unknown transport '${cfg.transport}'`);
    }
    return client;
  }
}
