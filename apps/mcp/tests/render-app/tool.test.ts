import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { RENDER_APP_RESOURCE_URI, renderAppModule } from "@/tools/render-app/tool.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

// The SDK types these results loosely (index signatures, text/blob unions), so
// narrow them with zod before asserting on specific fields.
const ToolSchema = z.looseObject({
  name: z.string(),
  _meta: z.looseObject({
    ui: z.looseObject({ resourceUri: z.string() }),
  }),
});

const TextResourceContentsSchema = z.looseObject({
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string(),
});

const CallToolResultSchema = z.looseObject({
  isError: z.boolean().optional(),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  content: z
    .array(
      z.looseObject({
        type: z.literal("text"),
        text: z.string(),
      }),
    )
    .optional(),
});

async function connect(): Promise<Client> {
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  renderAppModule.register(server);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(clientTransport);
  await client.connect(serverTransport);
  return client;
}

describe("render_app", () => {
  it("exposes an app tool linked to the UI resource", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === "render_app");
    expect(tool).toBeDefined();
    const parsed = ToolSchema.parse(tool);
    // registerAppTool also mirrors the URI under the flat "ui/resourceUri" key.
    expect(parsed._meta.ui.resourceUri).toBe(RENDER_APP_RESOURCE_URI);
  });

  it("serves the UI shell resource with the MCP Apps mime type", async () => {
    const client = await connect();
    const result = await client.readResource({ uri: RENDER_APP_RESOURCE_URI });
    const content = TextResourceContentsSchema.parse(result.contents[0]);
    expect(content.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(content.text.length > 0).toBe(true);
  });

  it("returns the app payload as structured content with a text fallback", async () => {
    const client = await connect();
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "render_app",
        arguments: { html: "<p>hello</p>", title: "Greeting" },
      }),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ html: "<p>hello</p>", title: "Greeting" });
    const text = result.content?.[0];
    expect(text?.type).toBe("text");
    expect(text?.text).toContain("Greeting");
  });

  it("defaults the title when omitted", async () => {
    const client = await connect();
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "render_app",
        arguments: { html: "<p>hello</p>" },
      }),
    );
    expect(result.structuredContent).toMatchObject({ title: "Interactive App" });
  });

  it("rejects oversized html documents", async () => {
    const client = await connect();
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "render_app",
        arguments: { html: "x".repeat(200_001) },
      }),
    );
    expect(result.isError).toBe(true);
  });
});
