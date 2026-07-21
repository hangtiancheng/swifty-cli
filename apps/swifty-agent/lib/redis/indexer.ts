/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Redis Stack vector indexer.
// Replaces lib/milvus/indexer.ts. Embeds chunks and stores them as Redis Hash
// entries with Float32 vectors (COSINE) instead of Milvus BinaryVector (HAMMING).
import { getRedisClient } from "./client";
import { float32ToBuffer } from "./utils";
import { embedTexts } from "@/lib/ai/embedder";
import { config } from "@/lib/config";

export interface IndexChunk {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

// P3-2 fix: cap content length to match the old Milvus schema (VarChar
// max_length=8192). Redis TEXT has no built-in limit, so we truncate here.
const MAX_CONTENT_LENGTH = 8192;

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
      content: chunks[i].content.slice(0, MAX_CONTENT_LENGTH),
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
// P1-9 fix: use SETNX to acquire a per-source lock so concurrent calls
// (e.g. two uploads for the same file) don't race on search-then-delete.
export async function deleteBySource(source: string): Promise<void> {
  const client = await getRedisClient();
  const escaped = escapeTagValue(source);
  const lockKey = `${config.redis.keyPrefix}lock:delete:${escaped}`;

  // Acquire lock (30s TTL as a safety net against deadlocks from crashes).
  const acquired = await client.set(lockKey, "1", { NX: true, EX: 30 });
  if (!acquired) {
    throw new Error(`Cannot acquire lock for source "${source}" — another deletion is in progress`);
  }

  try {
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
  } finally {
    await client.del(lockKey);
  }
}

// Redis TAG query requires escaping special characters; see RediSearch docs.
function escapeTagValue(value: string): string {
  return value.replace(/[,;<>(){}\[\]!"#$%&'*+/=?@^`|~\\]/g, "\\$&");
}
