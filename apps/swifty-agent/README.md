# Swifty Agent

AI intelligent OnCall assistant by Next.js 16 App Router + Vercel AI SDK.

## setup

### Redis Stack

```bash
docker compose up redis -d
```

---

## APIs

- `POST /api/chat` — non-streaming chat
- `POST /api/chat_stream` — SSE streaming chat
- `POST /api/upload` — upload a file (.txt/.md) to the knowledge base
- `POST /api/ai_ops` — AI Ops plan-execute-replan

## Notes

- On first use, upload a doc file via the "..." menu so the RAG knowledge base has content; otherwise retrieval returns empty.
- Embeddings are stored as native Float32 vectors with COSINE similarity (HNSW index) in Redis Stack, providing higher search fidelity than the previous BinaryVector + HAMMING approach.
- Tool definitions follow a three-layer split: `schemas.ts` (zod) → `operations.ts` (pure functions) → `index.ts` (AI SDK `tool` wrapper).
