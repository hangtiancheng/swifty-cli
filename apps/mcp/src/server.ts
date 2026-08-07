import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { modules } from "./tools/index.js";
import { version } from "./version.js";

export const SERVER_NAME = "swifty-mcp";

// Surfaced to clients at initialize time; swifty injects it into the model's
// context, improving tool selection.
const INSTRUCTIONS =
  "swifty-mcp provides tools for the Swifty CLI. Use search_docs to semantically " +
  "search the user's local knowledge base (Markdown/text files under ~/.swifty/docs) " +
  "whenever a question may be covered by project- or team-specific documents, " +
  "runbooks or notes.";

// registerTool throws on duplicate names — with per-request server instances
// in HTTP mode that would surface as runtime 500s, so fail fast at startup.
function assertUniqueModuleNames(): void {
  const seen = new Set<string>();
  for (const module of modules) {
    if (seen.has(module.name)) {
      throw new Error(`duplicate tool module name: ${module.name}`);
    }
    seen.add(module.name);
  }
}
assertUniqueModuleNames();

/**
 * Build an MCP server with every tool module registered. Cheap to call:
 * the HTTP transports create one instance per session/request while module
 * state stays in process-wide singletons.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version }, { instructions: INSTRUCTIONS });
  for (const module of modules) {
    module.register(server);
  }
  return server;
}
