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
import type { MCPServerConfig } from "../config/config.js";
import { MCPClient } from "./client.js";
import type { MCPTool } from "./client.js";

export interface ConnectResult {
  tools: { serverName: string; tool: MCPTool }[];
  servers: string[];
  errors: { serverName: string; error: string }[];
  instructions: { serverName: string; text: string }[];
}

export class MCPManager {
  private clients = new Map<string, MCPClient>();
  async connectAll(configs: MCPServerConfig[]): Promise<ConnectResult> {
    const result: ConnectResult = {
      tools: [],
      servers: [],
      errors: [],
      instructions: [],
    };

    for (const cfg of configs) {
      const client = new MCPClient(cfg);
      try {
        await client.connect();
        this.clients.set(cfg.name, client);
        result.servers.push(cfg.name);

        const tools = await client.listTools();
        for (const tool of tools) {
          result.tools.push({ serverName: cfg.name, tool });
        }

        const instructions = client.getInstructions();
        if (instructions) {
          result.instructions.push({
            serverName: cfg.name,
            text: instructions,
          });
        }
      } catch (err) {
        log.error({ err }, "mcp operation failed");
        result.errors.push({
          serverName: cfg.name,
          error: asErrorString(err),
        });
      }
    }

    return result;
  }

  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.clients.clear();
  }
}
