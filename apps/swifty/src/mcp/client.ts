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

// Note that because some servers are still using SSE, clients may need to support both transports during the migration period.

import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "mcp" });

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/sse.js";
import type { MCPServerConfig } from "../config/config.js";
import type { ToolSchema } from "@/tools/types.js";

type MCPTransport =
  | StdioClientTransport
  | StreamableHTTPClientTransport
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  | SSEClientTransport;

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: ToolSchema["input_schema"];
}

// Expand ${VAR} / $VAR references in config values from the environment so
// secrets (API keys etc.) can live in env vars rather than the config file.

// expandEnv("api_key: ${OPENAI_API_KEY}")
// if OPENAI_API_KEY=sk-xxx, returns "api_key: sk-xxx"

// expandEnv("host: $DATABASE_HOST")
// if DATABASE_HOST=localhost, returns "host: localhost"
function expandEnv(value: string): string {
  return value.replace(
    /\$\{(\w+)\}|\$(\w+)/g,
    (_, a: string, b: string) => process.env[a || b] ?? "",
  );
}

function asDict(obj: Record<string, string | undefined>): Record<string, string> {
  const dict: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    dict[k] = v ?? "";
  }
  return dict;
}

export class MCPClient {
  name: string;
  private config: MCPServerConfig;
  private client: Client | null = null;
  private transport: MCPTransport | null = null;

  constructor(config: MCPServerConfig) {
    this.name = config.name;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.config.command) {
      // stdio transport
      const env: NodeJS.ProcessEnv = process.env;
      if (this.config.env) {
        for (const [k, v] of Object.entries(this.config.env)) {
          env[k] = expandEnv(v);
        }
      }

      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env: asDict(env),
        stderr: "ignore",
      });
    } else if (this.config.url) {
      // http / sse transport

      const url = new URL(this.config.url);
      const headers: Record<string, string> = {};
      if (this.config.headers) {
        for (const [k, v] of Object.entries(this.config.headers)) {
          headers[k] = expandEnv(v);
        }
      }

      const opts: StreamableHTTPClientTransportOptions | SSEClientTransportOptions = {
        requestInit: { headers },
      };

      this.transport =
        this.config.transport === "sse"
          ? // eslint-disable-next-line @typescript-eslint/no-deprecated
            new SSEClientTransport(url, opts)
          : new StreamableHTTPClientTransport(url, opts);
    } else {
      throw new Error(
        `MCP server '${this.name}': needs either 'command' (stdio) or 'url' (http/sse)`,
      );
    }

    this.client = new Client({ name: "swifty", version: "0.1.0" }, {});
    await this.client.connect(this.transport);
  }

  // The server's instructions from the initialize result, if any.
  getInstructions(): string {
    return this.client?.getInstructions() ?? "";
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) {
      throw new Error("Not connected");
    }
    const result = await this.client.listTools();
    return result.tools.map(
      ({ name, description, inputSchema: { properties, ...inputSchemaRest } }) => ({
        name,
        description: description ?? "",
        inputSchema: { ...inputSchemaRest, properties: properties ?? {} },
      }),
    );
  }

  /** Calls a tool and returns { output, isError }. isError mirrors the MCP
   *  protocol's isError flag so the model knows when a tool failed. Mirrors Go's CallTool. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string; isError: boolean }> {
    if (!this.client) {
      throw new Error("Not connected");
    }
    const result = await this.client.callTool({ name, arguments: args });
    let output: string;
    if (result.content && Array.isArray(result.content)) {
      output = result.content
        .map((c: { type: string; text?: string }) =>
          c.type === "text" ? (c.text ?? "") : JSON.stringify(c),
        )
        .join("\n");
    } else {
      output = JSON.stringify(result);
    }
    // result.isError is set by the MCP server when the tool execution failed.
    return { output, isError: result.isError === true };
  }

  async disconnect(): Promise<void> {
    try {
      await this.client?.close();
    } catch (err) {
      log.error({ err }, "mcp operation failed");
      // ignore
    }
    this.client = null;
    this.transport = null;
  }
}
