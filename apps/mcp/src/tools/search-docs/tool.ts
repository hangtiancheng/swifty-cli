import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { loadConfig } from "../../shared/config.js";
import { logger } from "../../shared/logger.js";
import type { ToolModule } from "../types.js";
import { createEmbedder } from "./embedder.js";
import { syncDocs } from "./pipeline.js";
import { closeRedis, connectRedis, ensureIndex, type SearchDocsContext } from "./redis-client.js";
import { retrieve, type RetrievedDoc } from "./retriever.js";

type EngineState =
  | { status: "ready"; ctx: SearchDocsContext }
  | { status: "degraded"; reason: string };

// Process-wide engine singleton: initialization runs once in the background
// and every tool call (from any transport session) awaits the same promise.
let statePromise: Promise<EngineState> | null = null;

function getState(): Promise<EngineState> {
  statePromise ??= initEngine();
  return statePromise;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build the engine, degrading (never throwing) on any failure: a missing
 * embedding config, an unreachable provider, or a Redis without RediSearch
 * must not crash the server — the tool stays registered and reports why it
 * is unavailable.
 */
async function initEngine(): Promise<EngineState> {
  const config = loadConfig();

  if (!config.embedding.ok) {
    const reason = `embedding provider is not configured (${config.embedding.reason})`;
    logger.warn({ reason }, "search_docs degraded");
    return { status: "degraded", reason };
  }
  const embedder = createEmbedder(config.embedding.config);

  let ctx: SearchDocsContext;
  try {
    const client = await connectRedis(config.redis);
    ctx = { client, embedder, redis: config.redis };
  } catch (err) {
    const reason =
      `cannot connect to Redis at ${config.redis.url} ` +
      `(is Redis Stack running?): ${errorMessage(err)}`;
    logger.warn({ err }, "search_docs degraded: redis unreachable");
    return { status: "degraded", reason };
  }

  try {
    await ensureIndex(ctx);
    await syncDocs(ctx, config.docsDir);
  } catch (err) {
    await closeRedis(ctx.client);
    const reason =
      "failed to initialize the vector index (check the embedding endpoint/API key " +
      `and that Redis has the RediSearch module): ${errorMessage(err)}`;
    logger.warn({ err }, "search_docs degraded: index initialization failed");
    return { status: "degraded", reason };
  }

  logger.info("search_docs ready");
  return { status: "ready", ctx };
}

function formatResults(docs: RetrievedDoc[]): string {
  return docs
    .map((doc, i) => {
      const rawTitle = doc.metadata["title"];
      const title = typeof rawTitle === "string" && rawTitle !== "" ? rawTitle : "(untitled)";
      const rawSource = doc.metadata["_source"];
      const source = typeof rawSource === "string" ? rawSource : "(unknown)";
      const header = `[${String(i + 1)}] source: ${source} | title: ${title} | score: ${doc.score.toFixed(3)}`;
      return `${header}\n${doc.content}`;
    })
    .join("\n\n---\n\n");
}

const InputSchema = {
  query: z
    .string()
    .min(1)
    .describe("Natural-language question or keywords to search the knowledge base with."),
  top_k: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe("Number of most relevant chunks to return (1-10, default 3)."),
};

export const searchDocsModule: ToolModule = {
  name: "search_docs",

  register(server: McpServer): void {
    const docsDir = loadConfig().docsDir;
    server.registerTool(
      "search_docs",
      {
        title: "Search Docs",
        description:
          "Semantic search (embedding-based RAG) over the local Swifty knowledge base " +
          `built from Markdown/text documents in ${docsDir}. ` +
          "Use it to look up project- or team-specific knowledge, internal guides and notes. " +
          "Returns the most relevant document chunks with their source file, section title " +
          "and similarity score.",
        inputSchema: InputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ query, top_k }) => {
        const state = await getState();
        if (state.status === "degraded") {
          return {
            content: [{ type: "text", text: `search_docs is unavailable: ${state.reason}` }],
            isError: true,
          };
        }
        try {
          const docs = await retrieve(state.ctx, query, top_k);
          if (docs.length === 0) {
            return {
              content: [{ type: "text", text: "No matching documents in the knowledge base." }],
            };
          }
          return { content: [{ type: "text", text: formatResults(docs) }] };
        } catch (err) {
          logger.warn({ err }, "search_docs query failed");
          return {
            content: [{ type: "text", text: `search_docs failed: ${errorMessage(err)}` }],
            isError: true,
          };
        }
      },
    );
  },

  async init(): Promise<void> {
    await getState();
  },

  async shutdown(): Promise<void> {
    if (!statePromise) {
      return;
    }
    const state = await statePromise.catch(() => null);
    if (state !== null && state.status === "ready") {
      await closeRedis(state.ctx.client);
    }
  },
};
