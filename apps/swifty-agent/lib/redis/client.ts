// Redis Stack (RediSearch) client singleton + auto-create vector index.
// Replaces lib/milvus/client.ts. Stores embeddings as native Float32 vectors
// with HNSW + COSINE (vs. Milvus BinaryVector + HAMMING).
import { createClient, type RedisClientType } from "redis";
import { config, EMBEDDING_DIM } from "@/lib/config";

let clientPromise: Promise<RedisClientType> | null = null;

export function getRedisClient(): Promise<RedisClientType> {
  if (!clientPromise) {
    // P1-8 fix: reset clientPromise on failure so the next call can retry
    // instead of permanently caching a rejected promise.
    clientPromise = initClient().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

async function initClient(): Promise<RedisClientType> {
  // P1-8 fix: configure automatic reconnection with exponential backoff.
  // The redis client (v4+) supports reconnectStrategy on the socket — it
  // retries with increasing delays up to a 5s cap, so transient network
  // blips or Redis restarts don't permanently break the singleton.
  const client = createClient({
    url: config.redis.url,
    socket: {
      reconnectStrategy: (retries: number) => Math.min(retries * 100, 5000),
    },
  });
  client.on("error", (err) => console.error("Redis Client Error:", err));
  await client.connect();

  await ensureIndex(client);
  return client;
}

// P1-7 fix: verify the existing index's vector dimension matches EMBEDDING_DIM.
// If the embedding provider was switched (e.g. dashscope 2048d → ollama 768d)
// without dropping the index, searches silently fail. We detect the mismatch
// via FT.INFO and auto-recreate the index.
// P2-12 fix: use FT.INFO to check index existence instead of locale-dependent
// string matching on "Index already exists".
async function ensureIndex(client: RedisClientType): Promise<void> {
  let indexExists = false;
  try {
    const info = await client.ft.info(config.redis.indexName);
    indexExists = true;

    const attrs = (info as { attributes?: Array<Record<string, unknown>> }).attributes ?? [];
    const vectorAttr = attrs.find((a) => a.attribute === "vector" || a.identifier === "vector");
    if (vectorAttr) {
      const storedDim = Number(vectorAttr.DIM ?? vectorAttr.dim ?? 0);
      if (storedDim && storedDim !== EMBEDDING_DIM) {
        console.warn(
          `[redis] Index dimension mismatch: stored=${storedDim}, expected=${EMBEDDING_DIM}. ` +
            "Dropping and recreating index.",
        );
        await client.ft.dropIndex(config.redis.indexName);
        indexExists = false;
      }
    }
  } catch {
    // Index doesn't exist yet.
  }

  // If the index exists and dimension matches, nothing to do.
  if (indexExists) return;

  // Create the RediSearch vector index.
  await client.ft.create(
    config.redis.indexName,
    {
      vector: {
        type: "VECTOR",
        ALGORITHM: "HNSW",
        TYPE: "FLOAT32",
        DIM: EMBEDDING_DIM,
        DISTANCE_METRIC: "COSINE",
      },
      content: { type: "TEXT" },
      _source: { type: "TAG" },
    },
    { ON: "HASH", PREFIX: config.redis.keyPrefix },
  );
}
