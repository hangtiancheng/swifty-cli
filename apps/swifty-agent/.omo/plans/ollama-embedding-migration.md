# Ollama 本地 Embedding 接入计划

- 日期：2026-07-12
- 影响范围：`apps/swifty-agent`
- 技术方案：复用 `@ai-sdk/openai-compatible` 指向 Ollama OpenAI 兼容端点（`http://localhost:11434/v1`）
- API 规范：`POST /v1/embeddings { model, input }` — Ollama v0.1.24+ 原生支持，零新依赖

---

## 背景

当前 swifty-agent 仅支持 Alibaba DashScope 的 `text-embedding-v4` 模型（2048 维 float32）。以下场景需要 Ollama 本地 embedding：

- 本地开发环境无 DashScope API Key
- 内网/离线环境部署
- 降低延迟与 API 成本
- 开发调试阶段快速迭代

Ollama 从 v0.1.24 起原生提供 OpenAI 兼容的 `/v1/embeddings` 端点，可复用已有的 `@ai-sdk/openai-compatible` adapter，无需引入任何新依赖。

---

## 架构对比

| 维度             | 方案 A（推荐 / 本计划采用）                                  | 备选方案 B                   |
| ---------------- | ------------------------------------------------------------ | ---------------------------- |
| 实现方式         | `@ai-sdk/openai-compatible` 指向 `http://localhost:11434/v1` | 手动 fetch `/api/embeddings` |
| 新增依赖         | 无                                                           | 无                           |
| batch 能力       | `embedMany` 自动批量（Vercel AI SDK 内部处理）               | 需自己实现循环               |
| 与现有架构契合度 | 极高（与 dashscope 代码完全对称）                            | 中等（需自建 interface）     |

参考项目：`swifty-chatbot` 使用 `@langchain/ollama` 的 `OllamaEmbeddings`，但 swifty-agent 不依赖 LangChain，故不采纳此路径。

---

## 文件改动总览

| 文件                   | 类型 | 说明                                                                   |
| ---------------------- | ---- | ---------------------------------------------------------------------- |
| `lib/config.ts`        | 修改 | 添加 `ollama` 配置块、`embeddingProvider` 选择器、动态 `EMBEDDING_DIM` |
| `lib/ai/embedder.ts`   | 修改 | 用工厂函数替代硬编码 provider，根据 provider 路由                      |
| `lib/milvus/client.ts` | 不变 | `BINARY_VECTOR_DIM` 已是动态值，自动随 config 变化                     |
| `.env.example`         | 修改 | 添加 Ollama 相关环境变量                                               |

**不需要改动的文件**（均只消费 `embedder.ts` 的导出，对底层 provider 无感知）：
`lib/ai/pipelines/knowledge-index.ts`、`lib/ai/pipelines/chat.ts`、`lib/milvus/indexer.ts`、`lib/milvus/retriever.ts`、`lib/ai/tools/operations.ts`、`lib/ai/tools/index.ts`、`app/api/upload/route.ts`

---

## 详细改动

### 1. `lib/config.ts`

在 `dashscope` 配置块（L34-38）之后新增 `ollama` 块：

```ts
// 新增 — Ollama local embedding (OpenAI compatible)
ollama: {
  model: process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text",
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
},
```

在 `provider`（L52）之后新增 `embeddingProvider`：

```ts
// 新增 — Embedding provider selection: "dashscope" (default) | "ollama"
embeddingProvider: (process.env.EMBEDDING_PROVIDER ?? "dashscope") as "dashscope" | "ollama",
```

将 L64-68 的硬编码常量改为动态计算：

```ts
// 替换以下内容：
//   export const EMBEDDING_DIM = 2048;
//   export const BINARY_VECTOR_DIM = 65536;
//   export const BINARY_VECTOR_BYTES = BINARY_VECTOR_DIM / 8;

// 新代码：
export const EMBEDDING_DIM_MAP = {
  dashscope: 2048,
  ollama: 768, // nomic-embed-text 默认输出 768 维
} as const;

const _provider = (process.env.EMBEDDING_PROVIDER ?? "dashscope") as keyof typeof EMBEDDING_DIM_MAP;
export const EMBEDDING_DIM = EMBEDDING_DIM_MAP[_provider];

// float32 raw bytes → BinaryVector（HAMMING metric）
// 公式：dim float32 × 4 bytes × 8 bits = dim × 32 bits
export const BINARY_VECTOR_DIM = EMBEDDING_DIM * 32;
export const BINARY_VECTOR_BYTES = BINARY_VECTOR_DIM / 8;
```

---

### 2. `lib/ai/embedder.ts`

用工厂函数 `createEmbeddingProvider()` 替代模块顶层直接创建的常量（参考 `models.ts` 中 `resolveThinkModel` 的设计模式）：

```ts
import { embed, embedMany } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { config, EMBEDDING_DIM, BINARY_VECTOR_BYTES } from "@/lib/config";

// Provider factory — symmetric with resolveThinkModel/resolveQuickModel in models.ts
function createEmbeddingProvider() {
  if (config.embeddingProvider === "ollama") {
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: `${config.ollama.baseURL}/v1`,
      apiKey: "ollama", // Ollama 不需要 API Key，但 adapter 要求非空字符串
    });
    return ollama.textEmbeddingModel(config.ollama.model);
  }

  // Default: dashscope
  const dashscope = createOpenAICompatible({
    name: "dashscope",
    baseURL: config.dashscope.baseURL,
    apiKey: config.dashscope.apiKey,
  });
  return dashscope.textEmbeddingModel(config.dashscope.model);
}

export const embeddingModel = createEmbeddingProvider();

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: embeddingModel, values: texts });
  return embeddings;
}

/**
 * Float32 array → BinaryVector bytes.
 * 维度参数化为 EMBEDDING_DIM（随 embeddingProvider 动态变化）。
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
```

---

### 3. `lib/milvus/client.ts`（无需改动）

当前 schema（L20-24）已直接读取 `BINARY_VECTOR_DIM`：

```ts
{
  name: MILVUS_FIELDS.vector,
  data_type: DataType.BinaryVector,
  type_params: { dim: BINARY_VECTOR_DIM }, // ← 已从 config.ts 动态派生
},
```

`config.ts` 动态化后，这里自动适配。

---

### 4. `.env.example`（新增部分，以 `# 新增` 标注）

```bash
# Ollama local embedding (OpenAI compatible endpoint)        # 新增
# Used when EMBEDDING_PROVIDER=ollama                        # 新增
OLLAMA_EMBEDDING_MODEL=nomic-embed-text                     # 新增
OLLAMA_BASE_URL=http://localhost:11434                       # 新增

# Embedding provider: "dashscope" (default) | "ollama"       # 新增
EMBEDDING_PROVIDER=dashscope                                 # 新增
```

---

## 数据兼容性与 Milvus 重建

### 问题说明

| provider                       | float dim | BinaryVector bits | BinaryVector bytes |
| ------------------------------ | --------- | ----------------- | ------------------ |
| dashscope（text-embedding-v4） | 2048      | 65536             | 8192               |
| ollama（nomic-embed-text）     | 768       | 24576             | 3072               |

切换 provider 后，旧 collection 中的向量维度与新向量不兼容，Milvus HAMMING 搜索会报错。

### 处理步骤

切换 provider 后，在应用启动前手动删除旧 collection：

```bash
# pymilvus CLI（如已安装）
milvus delete-collection --name biz

# 或临时在代码中调用（启动前执行一次）：
# await client.dropCollection({ collection_name: config.milvus.collection })
```

删除后重启应用，`client.ts` 自动以新维度创建 collection 并建索引。

---

## 验证步骤

### 前置检查

```bash
# 确认 Ollama 已安装并运行，且已拉取 nomic-embed-text 模型
ollama list
# 期望输出包含：nomic-embed-text  latest  ...

# 否则执行
ollama pull nomic-embed-text

# 验证 OpenAI 兼容端点可用
curl http://localhost:11434/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "nomic-embed-text", "input": "hello"}' \
  | jq '.data[0].embedding | length'
# 期望输出：768
```

### 应用启动验证

```bash
# 修改 .env
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# 删除旧 collection（见§数据兼容性）

# 启动
pnpm dev
```

Milvus 日志中出现 `collection biz created with dim 24576`（768 × 32）表示维度配置正确。

### 端到端验证

```bash
# 上传文档
curl -X POST http://localhost:3000/api/upload \
  -F "file=@test.md" \
  -F "username=test"

# 触发 chat（含 RAG retrieve）
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"content": "文档中提到的xxx是什么？", "username": "test"}'
```

期望：无报错，能检索到相关文档片段并生成回答。

### 切回 dashscope 验证

将 `.env` 中 `EMBEDDING_PROVIDER` 改回 `dashscope`，删除 biz collection，重启，重复上传 + chat，确认功能正常。

---

## 实施顺序

| 步骤 | 操作                                                                 | 验证点                                                            |
| ---- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1    | 修改 `lib/config.ts`                                                 | `tsc --noEmit` 通过；`EMBEDDING_DIM` 随 `EMBEDDING_PROVIDER` 变化 |
| 2    | 修改 `lib/ai/embedder.ts`                                            | `tsc --noEmit` 通过；Ollama 模式启动后成功调用 `/v1/embeddings`   |
| 3    | 更新 `.env.example`                                                  | 文档完整                                                          |
| 4    | 设置 `EMBEDDING_PROVIDER=ollama`，删除旧 Milvus collection，启动应用 | 应用无报错；Biz collection 创建，dim=24576                        |
| 5    | 端到端：上传 + chat                                                  | 能检索到文档并回答                                                |
| 6    | 切换回 `EMBEDDING_PROVIDER=dashscope`，重复步骤 4-5                  | 功能正常，dim=65536                                               |

---

## AGENTS.md 更新（实施完成后）

```diff
- Embedding: Alibaba DashScope text-embedding-v4 via `@ai-sdk/openai-compatible`
+ Embedding: Alibaba DashScope text-embedding-v4 / Ollama nomic-embed-text via `@ai-sdk/openai-compatible`; selected by `EMBEDDING_PROVIDER` env var ("dashscope" | "ollama")
```

---

## `.env.example` 完整示例

```bash
# LLM Provider: "openai" (default) or "anthropic"
LLM_PROVIDER=openai

# DeepSeek (Volcano Engine Ark, OpenAI compatible)
DEEPSEEK_THINK_MODEL=deepseek-v3-2-251201
DEEPSEEK_THINK_API_KEY=
DEEPSEEK_THINK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DEEPSEEK_QUICK_MODEL=deepseek-v3-2-251201
DEEPSEEK_QUICK_API_KEY=
DEEPSEEK_QUICK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3

# Anthropic (used when LLM_PROVIDER=anthropic)
ANTHROPIC_THINK_MODEL=claude-sonnet-4-20250514
ANTHROPIC_THINK_API_KEY=
ANTHROPIC_THINK_BASE_URL=https://api.anthropic.com
ANTHROPIC_QUICK_MODEL=claude-sonnet-4-20250514
ANTHROPIC_QUICK_API_KEY=
ANTHROPIC_QUICK_BASE_URL=https://api.anthropic.com
ANTHROPIC_THINKING=true
ANTHROPIC_MAX_OUTPUT_TOKENS=8192

# Alibaba DashScope embedding (OpenAI compatible, for RAG knowledge base)
# Used when EMBEDDING_PROVIDER=dashscope
DASHSCOPE_EMBEDDING_MODEL=text-embedding-v4
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# Ollama local embedding (OpenAI compatible endpoint)
# Used when EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_BASE_URL=http://localhost:11434

# Embedding provider: "dashscope" (default) | "ollama"
EMBEDDING_PROVIDER=dashscope

# Milvus vector database
MILVUS_ADDRESS=localhost:19530
MILVUS_DB=agent
MILVUS_COLLECTION=biz

# MCP (Log tool SSE)
MCP_URL=http://localhost:3000/sse

# File upload directory (for knowledge base documents)
FILE_DIR=./data/docs

# Prometheus
PROMETHEUS_BASE_URL=http://127.0.0.1:9090
```
