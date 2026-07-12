// Centralize environment variable reading, replacing the source project's GoFrame g.Cfg().
// Next.js automatically loads .env / .env.local; importing dotenv/config here serves as a safeguard (for script scenarios).
import "dotenv/config";

export const config = {
  // DeepSeek (Volcano engine Ark, OpenAI compatible). 'think' is used for planning/replanning, 'quick' is used for execution/chat.
  deepseek: {
    think: {
      model: process.env.DEEPSEEK_THINK_MODEL ?? "deepseek-v3-2-251201",
      apiKey: process.env.DEEPSEEK_THINK_API_KEY ?? "",
      baseURL: process.env.DEEPSEEK_THINK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
    },
    quick: {
      model: process.env.DEEPSEEK_QUICK_MODEL ?? "deepseek-v3-2-251201",
      apiKey: process.env.DEEPSEEK_QUICK_API_KEY ?? "",
      baseURL: process.env.DEEPSEEK_QUICK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
    },
  },
  anthropic: {
    think: {
      model: process.env.ANTHROPIC_THINK_MODEL ?? "claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_THINK_API_KEY ?? "",
      baseURL: process.env.ANTHROPIC_THINK_BASE_URL ?? "https://api.anthropic.com",
    },
    quick: {
      model: process.env.ANTHROPIC_QUICK_MODEL ?? "claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_QUICK_API_KEY ?? "",
      baseURL: process.env.ANTHROPIC_QUICK_BASE_URL ?? "https://api.anthropic.com",
    },
    thinking: process.env.ANTHROPIC_THINKING !== "false", // default enabled
    maxOutputTokens: Number.parseInt(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS ?? "8192", 10),
  },
  // Alibaba Bailian DashScope embedding (OpenAI compatible)
  dashscope: {
    model: process.env.DASHSCOPE_EMBEDDING_MODEL ?? "text-embedding-v4",
    apiKey: process.env.DASHSCOPE_API_KEY ?? "",
    baseURL: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  // Ollama local embedding (OpenAI compatible endpoint, v0.1.24+)
  ollama: {
    model: process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text",
    baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  },
  // Milvus
  milvus: {
    address: process.env.MILVUS_ADDRESS ?? "localhost:19530",
    db: process.env.MILVUS_DB ?? "agent",
    collection: process.env.MILVUS_COLLECTION ?? "biz",
  },
  // MCP (Log tool SSE)
  mcpUrl: process.env.MCP_URL ?? "http://localhost:3000/sse",
  // File upload directory
  fileDir: process.env.FILE_DIR ?? "./data/docs",
  // Prometheus
  prometheusBaseUrl: process.env.PROMETHEUS_BASE_URL ?? "http://127.0.0.1:9090",
  // LLM provider selection: "openai" (default) | "anthropic"
  provider: (process.env.LLM_PROVIDER ?? "openai") as "openai" | "anthropic",
  // Embedding provider selection: "dashscope" (default) | "ollama"
  embeddingProvider: (process.env.EMBEDDING_PROVIDER ?? "dashscope") as "dashscope" | "ollama",
} as const;

// Milvus field names (aligned with source project utility/common + indexer fields)
export const MILVUS_FIELDS = {
  id: "id",
  vector: "vector",
  content: "content",
  metadata: "metadata",
} as const;

// Embedding dimension per provider (float32 count).
// - dashscope text-embedding-v4: 2048
// - ollama nomic-embed-text: 768
export const EMBEDDING_DIM_MAP = {
  dashscope: 2048,
  ollama: 768,
} as const;

// Active embedding dimension. Derived from the selected provider by default; override via
// the EMBEDDING_DIM env var when using a non-default model (e.g. ollama bge-m3 = 1024).
const envEmbeddingDim = process.env.EMBEDDING_DIM
  ? Number.parseInt(process.env.EMBEDDING_DIM, 10)
  : undefined;
export const EMBEDDING_DIM =
  envEmbeddingDim && envEmbeddingDim > 0
    ? envEmbeddingDim
    : EMBEDDING_DIM_MAP[config.embeddingProvider];

// The source project stores the raw bytes of N float32s (N*4 bytes = N*32 bits) as a BinaryVector,
// using HAMMING metric. Hence BinaryVector dim = EMBEDDING_DIM * 32, bytes = dim / 8.
// - dashscope: 2048 * 32 = 65536 bits → 8192 bytes
// - ollama:     768 * 32 = 24576 bits → 3072 bytes
export const BINARY_VECTOR_DIM = EMBEDDING_DIM * 32;
export const BINARY_VECTOR_BYTES = BINARY_VECTOR_DIM / 8;

// Conversation memory window size (aligned with source project utility/mem MaxWindowSize)
export const MEMORY_WINDOW_SIZE = 6;
