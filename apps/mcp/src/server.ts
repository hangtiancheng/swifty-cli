import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { modules } from "./tools/index.js";
import { version } from "./version.js";

export const SERVER_NAME = "swifty-mcp";

/**
 * Build an MCP server with every tool module registered. Cheap to call:
 * the HTTP transports create one instance per session/request while module
 * state stays in process-wide singletons.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });
  for (const module of modules) {
    module.register(server);
  }
  return server;
}
