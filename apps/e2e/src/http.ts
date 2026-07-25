import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "@koa/bodyparser";
import type { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse";
import { createServer } from "./server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";
import { randomUUID } from "crypto";

const app = new Koa();
const router = new Router();

app.use(bodyParser());

const sseTransports = new Map<string, SSEServerTransport>();

router.get("/sse", async (ctx) => {
  // // Koa equivalent of hijack
  // ctx.respond = false;

  const transport = new SSEServerTransport("/messages", ctx.res);
  const server = createServer();
  sseTransports.set(transport.sessionId, transport);
  ctx.res.on("close", () => {
    sseTransports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

router.post("/messages", async (ctx) => {
  const sessionId = ctx.query["sessionId"];
  if (typeof sessionId !== "string") {
    ctx.status = 400;
    ctx.body = { error: "Unknown session" };
    return;
  }

  const transport = sseTransports.get(sessionId);
  if (!transport) {
    ctx.status = 400;
    ctx.body = { error: "Unknown session" };
    return;
  }

  await transport.handlePostMessage(ctx.req, ctx.res, ctx.request.body);
});

// Streamable HTTP transport endpoint
router.post("/mcp", async (ctx) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
  });
  await server.connect(transport);
  await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
});


router.get("/mcp", async (ctx) => {
  ctx.status = 405; // Method Not Allowed
  ctx.body = { error: "Method Not Allowed" }
  return;
})


app.use(router.routes())
app.use(router.allowedMethods());

const port = Number.parseInt(process.env["PORT"] || "3300", 10);
app.listen(port, () => { 
  console.log(`MCP HTTP server listening on https://localhost:${port}`);
  console.log(`
    SSE endpoint     GET /sse
    SSE messages     POST /messages?sessionId=...
    Streamable HTTP  POST /mcp
    `)
})
