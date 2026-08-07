import type { Server } from "node:http";

import { bodyParser } from "@koa/bodyparser";
import Router from "@koa/router";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Koa from "koa";

import { createServer } from "./server.js";
import { logger } from "./shared/logger.js";

/**
 * HTTP transports host. Exposes both remote MCP transports on one port:
 * - Streamable HTTP:  POST /mcp        (stateless, JSON responses)
 * - legacy SSE:       GET /sse + POST /messages?sessionId=...
 * No authentication in this iteration: intended for localhost / trusted
 * networks only.
 */
export function startHttpServer(port: number): Server {
  const app = new Koa();
  const router = new Router();

  // Stateless Streamable HTTP: a fresh McpServer + transport per request.
  // Tool-module state lives in process-wide singletons, so instances are cheap
  // and no session bookkeeping is needed.
  router.post("/mcp", async (ctx) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    // The SDK writes the response directly to the raw socket.
    ctx.respond = false;
    ctx.res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
  });

  router.get("/mcp", (ctx) => {
    // Stateless mode has no server-initiated notification stream.
    ctx.status = 405;
    ctx.body = { error: "Method Not Allowed" };
  });

  // Legacy SSE: one long-lived transport per GET /sse connection, messages
  // posted back on /messages correlated by sessionId.
  const sseTransports = new Map<string, SSEServerTransport>();

  router.get("/sse", async (ctx) => {
    ctx.respond = false;
    const transport = new SSEServerTransport("/messages", ctx.res);
    sseTransports.set(transport.sessionId, transport);
    ctx.res.on("close", () => {
      sseTransports.delete(transport.sessionId);
    });
    const server = createServer();
    await server.connect(transport);
  });

  router.post("/messages", async (ctx) => {
    const sessionId = ctx.query["sessionId"];
    const transport = typeof sessionId === "string" ? sseTransports.get(sessionId) : undefined;
    if (!transport) {
      ctx.status = 400;
      ctx.body = { error: "Unknown session" };
      return;
    }
    ctx.respond = false;
    await transport.handlePostMessage(ctx.req, ctx.res, ctx.request.body);
  });

  app.on("error", (err: unknown) => {
    logger.warn({ err }, "http server error");
  });
  app.use(bodyParser());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app.listen(port, () => {
    logger.info(
      { port, streamableHttp: "POST /mcp", sse: "GET /sse, POST /messages?sessionId=..." },
      "MCP HTTP server listening",
    );
  });
}
