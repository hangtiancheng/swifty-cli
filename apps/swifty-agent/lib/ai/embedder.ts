// Corresponds to the source project's internal/ai/embedder/embedder.go
// Embedding via @ai-sdk/openai-compatible; provider selected by EMBEDDING_PROVIDER:
//   "dashscope" (default, text-embedding-v4) | "ollama" (local, nomic-embed-text)
import { embed, embedMany, type EmbeddingModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { config, EMBEDDING_DIM, BINARY_VECTOR_BYTES } from "@/lib/config";

// Provider factory — symmetric with resolveThinkModel/resolveQuickModel in models.ts
function createEmbeddingProvider(): EmbeddingModel {
  if (config.embeddingProvider === "ollama") {
    // Ollama exposes an OpenAI-compatible /v1/embeddings endpoint (v0.1.24+).
    // No API key is required, but the adapter demands a non-empty string.
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: `${config.ollama.baseURL}/v1`,
      apiKey: "ollama",
    });
    return ollama.textEmbeddingModel(config.ollama.model);
  }

  // Default: dashscope (text-embedding-v4, OpenAI compatible)
  const dashscope = createOpenAICompatible({
    name: "dashscope",
    baseURL: config.dashscope.baseURL,
    apiKey: config.dashscope.apiKey,
  });
  return dashscope.textEmbeddingModel(config.dashscope.model);
}

export const embeddingModel = createEmbeddingProvider();

// Get float embedding for a single text (dimension depends on the active provider)
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}

// Batch get embeddings
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: texts,
  });
  return embeddings;
}

/**
 * Float32 array → BinaryVector bytes.
 * Dimension is parameterized via EMBEDDING_DIM (varies with the active embedding provider).
 * Aligned with the source project: stores the raw byte stream of N float32s as a BinaryVector,
 * using HAMMING metric. (N float32 × 4 bytes × 8 bits = N*32 bits)
 */
export function float32ToBinaryVector(floats: number[]): Buffer {
  if (floats.length !== EMBEDDING_DIM) {
    throw new Error(`embedding dim mismatch: expected ${EMBEDDING_DIM}, got ${floats.length}`);
  }
  const arr = new Float32Array(floats);
  const buf = Buffer.from(arr.buffer);
  if (buf.length !== BINARY_VECTOR_BYTES) {
    throw new Error(
      `binary vector bytes mismatch: expected ${BINARY_VECTOR_BYTES}, got ${buf.length}`,
    );
  }
  return buf;
}
