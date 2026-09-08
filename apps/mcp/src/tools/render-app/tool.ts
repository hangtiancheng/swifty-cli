import { readFile } from "node:fs/promises";

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { logger } from "../../shared/logger.js";
import type { ToolModule } from "../types.js";

export const RENDER_APP_RESOURCE_URI = "ui://render-app/mcp-app.html";

// The shell renders user HTML through a same-document srcdoc iframe, which
// inherits the host's CSP for the app resource. Without this allowlist, every
// CDN script/font/style in model-authored HTML would be silently blocked.
const RESOURCE_DOMAINS = [
  "https://unpkg.com",
  "https://cdn.jsdelivr.net",
  "https://cdn.tailwindcss.com",
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

// Tool results and the UI bridge are JSON; a large cap keeps them within
// typical host message limits while still allowing rich single-file apps.
const MAX_HTML_CHARS = 200_000;

const InputSchema = {
  html: z
    .string()
    .min(1)
    .max(MAX_HTML_CHARS)
    .describe(
      "Complete, self-contained HTML document to render (doctype, styles and scripts " +
        "inlined). Scripts run in a sandboxed iframe without storage or cookies. " +
        `External assets may only load from popular CDNs (${RESOURCE_DOMAINS.join(", ")}). ` +
        `Keep it under ${String(MAX_HTML_CHARS)} characters.`,
    ),
  title: z
    .string()
    .min(1)
    .max(120)
    .default("Interactive App")
    .describe("Short human-readable label shown above the app."),
};

const NO_UI_FALLBACK_NOTE =
  "Interactive app delivered via the render_app UI; hosts without MCP Apps support " +
  "cannot display it.";

// Served when the single-file shell has not been built yet (e.g. running from
// source without `pnpm build`), so resources/read never fails.
const UNBUILT_SHELL_HTML =
  '<!doctype html><html><body style="font-family:system-ui;padding:24px">' +
  "<p>render_app UI shell is not built yet. Run <code>pnpm build</code> in " +
  "apps/mcp to generate dist/mcp-app.html.</p></body></html>";

async function readAppHtml(): Promise<string> {
  // Bundled binary resolves dist/main.js's sibling; tsx from src/ resolves the
  // package-level dist directory three levels up.
  const candidates = [
    new URL("./mcp-app.html", import.meta.url),
    new URL("../../../dist/mcp-app.html", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf-8");
    } catch {
      // Try the next candidate path.
    }
  }
  logger.warn("render_app UI shell not found (run pnpm build); serving placeholder");
  return UNBUILT_SHELL_HTML;
}

export const renderAppModule: ToolModule = {
  name: "render_app",

  register(server: McpServer): void {
    registerAppTool(
      server,
      "render_app",
      {
        title: "Render App",
        description:
          "Render a complete HTML document as an interactive app (MCP App) inline in the " +
          "conversation. Use it whenever the user wants to see or interact with a result " +
          "rather than read text: charts, dashboards, diagrams, calculators, small " +
          "simulations, games or forms. The HTML must be self-contained (inline CSS/JS); " +
          "it runs in a sandboxed iframe, so there is no storage, cookies or access to " +
          "the host. Returns app metadata; UI-capable hosts display the app automatically.",
        inputSchema: InputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: { ui: { resourceUri: RENDER_APP_RESOURCE_URI } },
      },
      async ({ html, title }) => {
        logger.debug({ bytes: html.length, title }, "render_app invoked");
        return {
          content: [
            { type: "text", text: `Rendered interactive app "${title}". ${NO_UI_FALLBACK_NOTE}` },
          ],
          structuredContent: { html, title },
        };
      },
    );

    registerAppResource(
      server,
      "Render App UI",
      RENDER_APP_RESOURCE_URI,
      {
        description:
          "Sandboxed shell that displays the render_app tool result as an interactive app.",
      },
      async () => ({
        contents: [
          {
            uri: RENDER_APP_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: await readAppHtml(),
            _meta: { ui: { csp: { resourceDomains: RESOURCE_DOMAINS } } },
          },
        ],
      }),
    );
  },
};
