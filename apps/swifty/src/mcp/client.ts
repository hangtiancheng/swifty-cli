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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { MCPServerConfig } from "../config/config.js";
import { maybeResizeAndDownsampleImage } from "../images/resize.js";
import { asImageMediaType } from "../images/types.js";
import { createChildLogger } from "../logger/index.js";

import type { ToolSchema } from "@/tools/types.js";
import { version } from "@/tui/version.js";
import { isRecord } from "@/utils/index.js";

const log = createChildLogger({ module: "mcp" });
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

// MCP image content uses {type:"image", data, mimeType}; providers use
// {type:"image", source:{type:"base64", media_type, data}}. Unsupported mime
// types stay in the text form (JSON.stringify) as before.
const MCP_IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Convert an MCP tool-call content array into a ToolResult output: plain
 *  text when there is no image, otherwise provider-style content blocks
 *  (leading text block + image blocks). Oversized images are resized and
 *  recompressed through the shared image pipeline. */
export async function mcpContentToToolOutput(
  content: unknown[],
): Promise<string | Record<string, unknown>[]> {
  const textParts: string[] = [];
  const imageBlocks: Record<string, unknown>[] = [];
  for (const raw of content) {
    const c = isRecord(raw) ? raw : {};
    if (
      c.type === "image" &&
      typeof c.data === "string" &&
      typeof c.mimeType === "string" &&
      MCP_IMAGE_MEDIA_TYPES.has(c.mimeType)
    ) {
      try {
        const resized = await maybeResizeAndDownsampleImage(
          Buffer.from(c.data, "base64"),
          asImageMediaType(c.mimeType),
        );
        imageBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: resized.mediaType,
            data: resized.data,
          },
        });
        continue;
      } catch (err) {
        log.warn({ err }, "mcp image dropped (too large to fit the API limit)");
        textParts.push("[note: an image returned by the tool was too large and was dropped]");
        continue;
      }
    }
    textParts.push(c.type === "text" && typeof c.text === "string" ? c.text : JSON.stringify(raw));
  }

  const text = textParts.join("\n");
  if (imageBlocks.length === 0) {
    return text;
  }
  return [...(text ? [{ type: "text", text }] : []), ...imageBlocks];
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

    this.client = new Client({ name: "swifty", version }, {});
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
   *  protocol's isError flag so the model knows when a tool failed. Mirrors Go's CallTool.
   *  Image content blocks pass through as provider-style blocks instead of
   *  being flattened to JSON text. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string | Record<string, unknown>[]; isError: boolean }> {
    if (!this.client) {
      throw new Error("Not connected");
    }
    const result = await this.client.callTool({ name, arguments: args });
    let output: string | Record<string, unknown>[];
    if (result.content && Array.isArray(result.content)) {
      output = await mcpContentToToolOutput(result.content);
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
