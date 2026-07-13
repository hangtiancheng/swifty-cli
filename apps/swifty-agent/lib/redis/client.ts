// Redis Stack (RedisSearch) client singleton + auto-create vector index.
// Replaces lib/milvus/client.ts. Stores embeddings as native Float32 vectors
// with HNSW + COSINE (vs. Milvus BinaryVector + HAMMING).
import { createClient, type RedisClientType } from "redis";
import { config, EMBEDDING_DIM } from "@/lib/config";

let clientPromise: Promise<RedisClientType> | null = null;

export function getRedisClient(): Promise<RedisClientType> {
  if (!clientPromise) clientPromise = initClient();
  return clientPromise;
}

async function initClient(): Promise<RedisClientType> {
  const client = createClient({ url: config.redis.url });
  client.on("error", (err) => console.error("Redis Client Error:", err));
  await client.connect();

  // Create the RedisSearch vector index (idempotent: ignore "Index already exists").
  // NOTE: DIM is fixed at creation. If EMBEDDING_DIM changes (e.g. switching
  // embedding provider dashscope<->ollama), the index must be dropped and
  // recreated via FT.DROPINDEX idx:biz, then restart the app.
  try {
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
  } catch (e) {
    if (!String(e).includes("Index already exists")) throw e;
  }

  return client;
}
