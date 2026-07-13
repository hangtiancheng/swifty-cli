// Redis Stack vector indexer.
// Replaces lib/milvus/indexer.ts. Embeds chunks and stores them as Redis Hash
// entries with Float32 vectors (COSINE) instead of Milvus BinaryVector (HAMMING).
import { getRedisClient } from "./client";
import { embedTexts } from "@/lib/ai/embedder";
import { config } from "@/lib/config";

export interface IndexChunk {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

// float[] -> Float32 little-endian Buffer (Redis VECTOR FLOAT32 wire format)
function float32ToBuffer(floats: number[]): Buffer {
  return Buffer.from(new Float32Array(floats).buffer);
}

// Insert document chunks. hSet is idempotent (overwrites), so re-indexing the
// same id is safe. Uses MULTI/EXEC for atomic batch writes.
export async function indexChunks(chunks: IndexChunk[]): Promise<number> {
  if (chunks.length === 0) return 0;
  const client = await getRedisClient();
  const vectors = await embedTexts(chunks.map((c) => c.content));

  const pipeline = client.multi();
  for (let i = 0; i < chunks.length; i++) {
    const key = `${config.redis.keyPrefix}${chunks[i].id}`;
    pipeline.hSet(key, {
      vector: float32ToBuffer(vectors[i]),
      content: chunks[i].content,
      _source: String(chunks[i].metadata._source ?? ""),
      metadata: JSON.stringify(chunks[i].metadata),
      created_at: new Date().toISOString(),
    });
  }
  await pipeline.exec();
  return chunks.length;
}

// Delete all chunks whose metadata._source matches `source`.
// Redis has no single-statement DELETE-WHERE, so we search-then-delete in
// batches of 1000 to handle sources with many chunks safely.
export async function deleteBySource(source: string): Promise<void> {
  const client = await getRedisClient();
  const escaped = escapeTagValue(source);
  const BATCH = 1000;

  while (true) {
    const result = await client.ft.search(config.redis.indexName, `@_source:{${escaped}}`, {
      RETURN: [],
      LIMIT: { from: 0, size: BATCH },
    });
    if (result.total === 0 || result.documents.length === 0) return;

    const pipeline = client.multi();
    for (const doc of result.documents) {
      pipeline.del(doc.id);
    }
    await pipeline.exec();

    if (result.documents.length < BATCH) return;
  }
}

// Redis TAG query requires escaping special characters; see RedisSearch docs.
function escapeTagValue(value: string): string {
  return value.replace(/[,;<>(){}\[\]!"#$%&'*+/=?@^`|~\\]/g, "\\$&");
}
