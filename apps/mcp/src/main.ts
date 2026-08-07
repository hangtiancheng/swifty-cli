import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { startHttpServer } from "./http.js";
import { createServer } from "./server.js";
import { loadConfig } from "./shared/config.js";
import { logger } from "./shared/logger.js";
import { modules } from "./tools/index.js";

let shuttingDown = false;

/** Close transports and tool modules, then exit. Never runs twice. */
function shutdown(reason: string, closeTransport: () => Promise<void>): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ reason }, "shutting down");
  void (async () => {
    try {
      await closeTransport();
    } catch (err) {
      logger.warn({ err }, "transport close failed");
    }
    for (const module of modules) {
      try {
        await module.shutdown?.();
      } catch (err) {
        logger.warn({ err, module: module.name }, "module shutdown failed");
      }
    }
    process.exit(0);
  })();
}

function registerSignalHandlers(closeTransport: () => Promise<void>): void {
  process.on("SIGINT", () => {
    shutdown("SIGINT", closeTransport);
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM", closeTransport);
  });
}

async function main(): Promise<void> {
  const useHttp = process.argv.includes("--http") || process.env["MCP_TRANSPORT"] === "http";

  if (useHttp) {
    const { port } = loadConfig();
    const httpServer = startHttpServer(port);
    registerSignalHandlers(
      () =>
        new Promise<void>((resolve) => {
          httpServer.close(() => {
            resolve();
          });
        }),
    );
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // When the client disconnects, open handles like the Redis connection
    // would keep the process alive — exit through shutdown instead. The SDK
    // transport does not self-close on stdin EOF, so watch stdin directly.
    server.server.onclose = () => {
      shutdown("transport closed", () => Promise.resolve());
    };
    process.stdin.on("end", () => {
      shutdown("stdin closed", () => server.close());
    });
    process.stdin.on("close", () => {
      shutdown("stdin closed", () => server.close());
    });
    registerSignalHandlers(() => server.close());
    logger.info("MCP stdio server connected");
  }

  // Kick off module initialization only after the transport is up, so tools
  // are listable immediately; tool calls await the same init internally.
  for (const module of modules) {
    if (module.init) {
      void module.init().catch((err: unknown) => {
        logger.warn({ err, module: module.name }, "module init failed");
      });
    }
  }
}

void main().catch((err: unknown) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});
