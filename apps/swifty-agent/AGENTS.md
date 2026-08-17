<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

- NEVER add MIT license header manually!

<!-- END:nextjs-agent-rules -->

# Swifty Agent

AI intelligent OnCall assistant.

## Tech stack

- Next.js 16 App Router + React 19 + TypeScript
- Vercel AI SDK v7 (`ai`): streamText / generateText / generateObject / tool / embed / embedMany
- LLM: OpenAI-v3 (Volcengine Ark, OpenAI compatible) via `@ai-sdk/openai` createOpenAI
- Embedding: Alibaba DashScope text-embedding-v4 / Ollama nomic-embed-text via `@ai-sdk/openai-compatible`; selected by `EMBEDDING_PROVIDER` ("openai" | "ollama"); batch requests capped at 10 inputs
- Vector DB: Redis Stack (`redis`, index=idx:biz, key prefix=biz:, VECTOR FLOAT32 + HNSW + COSINE); index dim is probed from the embedding provider at startup and the index is auto-recreated on dim mismatch
- MySQL: `knex` + `mysql2` (mysql_crud tool uses knex.raw for dynamic SQL)
- MCP: `@modelcontextprotocol/sdk` (SSE log tools)
- Startup: `instrumentation.ts` register() embeds every doc in `FILE_DIR` (./data/docs)
- Frontend: Tailwind v4 atomic classes + streamdown (streaming markdown + Shiki code highlighting)

## Directory layout

- `app/` — Next.js App Router (page / layout / api route)
- `lib/` — server-side logic (ai / redis / memory / config / api-schemas)
- `components/` — React components
- `hooks/` — React hooks

## Coding conventions

- Styles use only Tailwind v4 atomic classes; do not create custom CSS classes (no styles.css).
- Tool definitions follow a three-layer split: `lib/ai/tools/schemas.ts` (zod) → `operations.ts` (pure functions) → `index.ts` (AI SDK `tool` wrapper).
- API responses are wrapped as `{ message, data }`.
- Configuration is read via `.env` + `lib/config.ts`; no yaml.
- Strict typing: validate runtime-unknown data with zod (`safeParse`/`parse`); no unnecessary type assertions, no `@ts-ignore` / `eslint-disable`.
