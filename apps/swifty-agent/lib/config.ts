// Centralize environment variable reading, replacing the source project's GoFrame g.Cfg().
// Next.js automatically loads .env / .env.local; importing dotenv/config here serves as a safeguard (for script scenarios).
import "dotenv/config";

export const config = {
  // OpenAI (Volcano engine Ark, OpenAI compatible). 'think' is used for planning/replanning, 'quick' is used for execution/chat.
  openai: {
    think: {
      model: process.env.OPENAI_THINK_MODEL ?? "openai-v3-2-251201",
      apiKey: process.env.OPENAI_THINK_API_KEY ?? "",
      baseURL: process.env.OPENAI_THINK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
    },
    quick: {
      model: process.env.OPENAI_QUICK_MODEL ?? "openai-v3-2-251201",
      apiKey: process.env.OPENAI_QUICK_API_KEY ?? "",
      baseURL: process.env.OPENAI_QUICK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
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
  // Redis Stack (RedisSearch module) — vector database
  redis: {
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
    indexName: process.env.REDIS_INDEX_NAME ?? "idx:biz",
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? "biz:",
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

// Conversation memory window size (aligned with source project utility/mem MaxWindowSize)
export const MEMORY_WINDOW_SIZE = 6;
