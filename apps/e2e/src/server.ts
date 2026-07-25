import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { version } from "./version.js";
import { Server } from "http";
import { z } from "zod";

export function createServer(): McpServer {
  const mcpServer = new McpServer({
    name: "swifty-e2e",
    version,
  });

  mcpServer.registerTool(
    "e2e",
    {
      title: "",
      description: "",
      inputSchema: z.looseObject({}),
      outputSchema: z.looseObject({}),
      annotations: {
        title: "",
        readOnlyHint: true,
        destructiveHint: false,
        // 是否幂等
        idempotentHint: false,
        // openWorldHint: true,
      },
    },
    async (args) => {
      return {
        content: {
          type: "text",
          text: "",
        },
      };
    },
  );

  return mcpServer
}
