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

// Redis Stack vector retriever.
// Replaces lib/milvus/retriever.ts. KNN search over Float32 vectors with
// COSINE distance (vs. Milvus HAMMING over BinaryVector).
import { z } from "zod/v4";
import { getRedisClient } from "./client";
import { float32ToBuffer } from "./utils";
import { embedText } from "@/lib/ai/embedder";
import { config } from "@/lib/config";

export interface RetrievedDoc {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

// Runtime validation of a RediSearch KNN result document. The SDK returns
// fields as unknown, so we parse with zod instead of casting (per AGENTS.md).
const docValueSchema = z.looseObject({
  content: z.unknown(),
  metadata: z.unknown(),
  // RediSearch injects __vector_score (COSINE distance: 0=identical, 2=opposite)
  __vector_score: z.unknown(),
});

const searchResultSchema = z.object({
  total: z.number(),
  documents: z.array(
    z.object({
      id: z.string(),
      value: docValueSchema,
    }),
  ),
});

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// P2-13 fix: convert COSINE distance [0, 2] to similarity score [0, 1]
// so that higher is better and the range matches the [0,1] convention
// expected by downstream consumers.
function distanceToScore(distance: unknown): number {
  const d = typeof distance === "number" ? distance : 0;
  return (2 - d) / 2;
}

export async function retrieve(query: string, topK = 1): Promise<RetrievedDoc[]> {
  const client = await getRedisClient();
  const vec = float32ToBuffer(await embedText(query));

  const raw = await client.ft.search(config.redis.indexName, `*=>[KNN ${topK} @vector $vec]`, {
    PARAMS: { vec },
    DIALECT: 2,
    RETURN: ["content", "metadata", "__vector_score"],
    LIMIT: { from: 0, size: topK },
  });

  const result = searchResultSchema.parse(raw);
  const prefix = config.redis.keyPrefix;

  return result.documents.map((doc) => ({
    id: doc.id.startsWith(prefix) ? doc.id.slice(prefix.length) : doc.id,
    content: String(doc.value.content ?? ""),
    metadata: parseMetadata(doc.value.metadata),
    score: distanceToScore(doc.value.__vector_score),
  }));
}
