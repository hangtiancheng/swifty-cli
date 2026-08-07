# Embedding Integration & Incident Notes

Knowledge captured from building and debugging the RAG embedding pipeline in
`apps/swifty-agent` (Vercel AI SDK v7 + OpenAI-compatible embedding providers +
Redis Stack vector search). This document covers only embedding: architecture,
fault attribution, dimension handling, batching, and an integration guide for
new projects.

---

## 1. Architecture Overview

```
                       ┌──────────────────────────────┐
  .env (provider pick) │  EMBEDDING_PROVIDER          │
                       │  "openai" | "ollama"         │
                       └──────────────┬───────────────┘
                                      ▼
        lib/ai/embedder.ts  ── createOpenAICompatible(...).embeddingModel(id)
              │  embedText(text)  → number[]     (single, used for queries + dim probe)
              │  embedTexts(list) → number[][]   (batched, used for indexing)
              ▼
        lib/redis/indexer.ts ── HSET biz:<uuid> {vector, content, _source, metadata}
              ▼
        Redis Stack (RediSearch) ── FT.CREATE idx:biz ... VECTOR HNSW FLOAT32 DIM <n> COSINE
              ▲
        lib/redis/retriever.ts ── FT.SEARCH `*=>[KNN k @vector $vec]` (query embedding)
```

Ingestion paths (both go through the same `buildKnowledgeIndex` pipeline —
load file → split by markdown `#` headers → delete old chunks by `_source` →
embed → HSET):

- **Startup**: `instrumentation.ts` `register()` scans `FILE_DIR` for
  `.md/.markdown/.txt` and indexes every file before the server accepts traffic.
- **Upload**: `POST /api/upload` writes the file into `FILE_DIR`, then indexes
  it. Because uploads land in `FILE_DIR`, every uploaded document is also
  re-indexed on the next boot — the data directory is the single source of truth.

Both providers are first-class; they differ in vector dimension and there is
deliberately **no cross-provider compatibility**: switching providers wipes and
rebuilds the index (see §3).

---

## 2. Incident: "Embedding doesn't work" — Fault Attribution

### Symptoms

- Uploads returned HTTP 200 and embedding API calls visibly succeeded, yet
  retrieval always returned nothing ("search error" in chat).
- No errors anywhere in application logs. The failure was completely silent.

### Diagnosis trail (reusable playbook)

```bash
# 1. Does the index exist, and what does it think the world looks like?
redis-cli FT._LIST
redis-cli FT.INFO idx:biz | grep -A1 -E "^dim$|num_docs|hash_indexing_failures"

# 2. Is there data under the prefix even though num_docs is 0?
redis-cli --scan --pattern 'biz:*' | wc -l
redis-cli HSTRLEN biz:<some-id> vector        # bytes; dim = bytes / 4 (FLOAT32)

# 3. What does the embedding endpoint ACTUALLY return?
curl -sS "$BASE_URL/embeddings" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"<model>","input":["hello"]}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data[0].embedding.length))"
```

### Findings

| Check | Value | Meaning |
|---|---|---|
| `FT.INFO ... dim` | 2048 | Index was created from static config |
| `HSTRLEN <key> vector` | 4096 bytes = **1024** floats | The model really returns 1024-d vectors |
| `num_docs` | 0 | Nothing was ever searchable |
| `hash_indexing_failures` | 2 (== number of writes) | Every HSET was rejected by the indexer |

### Root cause

The index dimension came from a **static config map** (`openai → 2048`,
`ollama → 768`, overridable by `EMBEDDING_DIM`). The deployed endpoint served a
different model (`qwen3.7-text-embedding`, 1024-d), so config said 2048 while
the provider returned 1024.

**The critical failure mode:** RediSearch does *not* raise an error to the
writer when a hash's vector blob size (`dim × 4` bytes for FLOAT32) doesn't
match the index `DIM`. The `HSET` succeeds; the document is simply skipped by
the indexer and `hash_indexing_failures` is incremented. From the
application's perspective everything "worked" — embed call OK, write OK —
but `num_docs` stayed at 0 forever.

### Lessons

1. **Never trust a statically configured dimension.** Model deployments behind
   OpenAI-compatible gateways change; some models support variable dimensions;
   config drifts. The only authoritative source is the vector the provider
   actually returns.
2. **`hash_indexing_failures` is the smoking gun.** Make it the first thing you
   check when writes "succeed" but searches return nothing. `num_docs == 0`
   with keys present under the prefix ⇒ dimension (or schema) mismatch.
3. **Silent-failure boundaries deserve runtime verification.** Any place where
   two systems must agree on a contract (embedding dim ↔ index dim) and one
   side fails silently needs an active check, not documentation.

---

## 3. Dimension Handling: Probe, Don't Configure

The fix (in `lib/redis/client.ts` `ensureIndex`) makes the runtime probe
authoritative:

```ts
// On every cold start, before creating/validating the index:
const dim = (await embedText("dimension probe")).length;
```

Algorithm:

1. **Probe** the active provider with one short text; take `embedding.length`.
2. **Compare** with the existing index's `DIM` from `FT.INFO`.
   - Match → done, index untouched, data untouched.
   - Mismatch → `FT.DROPINDEX`, then fall through to (3).
3. **Clean slate on (re)creation**: `SCAN`-delete **all keys under the prefix**
   before `FT.CREATE ... DIM <probed>`.
4. Startup indexing (`indexDataDir`) repopulates from `FILE_DIR` immediately
   after, so the knowledge base converges automatically.

Why step 3 matters (second bug found during verification): `FT.DROPINDEX`
without deleting data leaves old hashes in place, and `FT.CREATE` triggers a
**background rescan** that re-indexes them into the new index. Meanwhile the
"delete old chunks by `_source`" dedup step runs a `FT.SEARCH` — which can
execute *before* the background rescan has picked those old hashes up, see
zero results, and skip deletion. Net effect: duplicated chunks (we observed 4
docs where 2 were expected). Stale-dimension vectors are useless anyway, so
wiping the prefix on index (re)creation is both simpler and correct.

Design decisions worth copying:

- **No `EMBEDDING_DIM` env var at all.** It was removed. A knob that can
  contradict reality is a foot-gun; the probe costs one embedding call
  (~100 ms) per cold start.
- **No cross-provider/dim migration.** Vectors from different models are not
  comparable — re-embedding is the only correct "migration". Treat a provider
  or model switch as: wipe → recreate index at new dim → re-embed sources.
- **Query-time symmetry is free.** Queries embed with the same
  `embeddingModel` singleton, so query vectors always match the index dim as
  long as the index was created via the probe.

---

## 4. Batch Limits for `embedMany`

Three different limits stack on top of each other; the *smallest* wins:

| Layer | Limit | Failure mode when exceeded |
|---|---|---|
| AI SDK `@ai-sdk/openai-compatible` default `maxEmbeddingsPerCall` | 2048 | sends everything in one request |
| Gateway tested in this project | 20 | HTTP 400 `batch size is invalid, it should not be larger than 20` |
| DashScope `text-embedding-v4` (documented) | 10 | HTTP 400 |

The SDK's `createOpenAICompatible(...)` factory does **not** expose
`maxEmbeddingsPerCall` (it's only settable when constructing
`OpenAICompatibleEmbeddingModel` directly), so the pragmatic fix is manual
chunking in the app-level helper (`lib/ai/embedder.ts`):

```ts
const EMBED_BATCH_SIZE = 10;            // min() of all documented provider limits

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: texts.slice(i, i + EMBED_BATCH_SIZE),
    });
    results.push(...embeddings);
  }
  return results;
}
```

Notes:

- Order is preserved (`embedMany` returns embeddings in input order; batches
  are concatenated sequentially), which the indexer relies on to pair
  `vectors[i]` with `chunks[i]`.
- Without this, any document splitting into >10 chunks fails to index — which
  masquerades as "upload doesn't embed" even though small files work. Always
  test ingestion with a document that crosses the batch boundary
  (e.g. 12 sections).
- Ollama has no meaningful batch cap, but batching at 10 is harmless there.

---

## 5. Adjacent Pitfall: RediSearch TAG Escaping in the Dedup Path

Not an embedding bug per se, but it broke the embedding pipeline's
delete-then-reinsert dedup: `_source` is a TAG field queried as
`@_source:{<filename>}`, and TAG syntax treats `-`, `.`, spaces and most
punctuation as special. A partial escape list missed `-`/`.`, so any filename
like `upload-test.md` produced `Syntax error at offset ...` and the whole
upload failed. Robust escape — allow-list instead of deny-list:

```ts
function escapeTagValue(value: string): string {
  return value.replace(/[^\p{L}\p{N}_]/gu, "\\$&");   // keep letters/digits/_ (incl. CJK)
}
```

---

## 6. Integrating Embedding into a New Project (Checklist)

### 6.1 Provider layer

- Use one factory that returns an `EmbeddingModel` based on an env switch;
  both cloud (OpenAI-compatible) and local (Ollama exposes OpenAI-compatible
  `/v1/embeddings` since v0.1.24) go through `createOpenAICompatible`:

  ```ts
  const provider = createOpenAICompatible({ name, baseURL, apiKey });
  export const embeddingModel = provider.embeddingModel(modelId);
  ```

- Ollama needs a dummy non-empty `apiKey` ("ollama") because the adapter
  requires one.
- Expose exactly two helpers: `embedText` (query + probe) and `embedTexts`
  (ingestion, batched per §4). Everything else consumes these.

### 6.2 Vector store layer

- Create the index lazily inside the client singleton (`getRedisClient` →
  `ensureIndex`), guarded so failures reset the cached promise (retryable).
- **Probe the dimension at index-ensure time** (§3). Never accept it from
  config.
- On dim mismatch or first creation: wipe prefix keys, then
  `FT.CREATE ... VECTOR HNSW FLOAT32 DIM <probed> COSINE` with `ON HASH`,
  `PREFIX <keyPrefix>`.
- Store vectors as `Buffer` of little-endian float32 (`float32ToBuffer`);
  `dim × 4` bytes must equal index DIM or the doc is silently skipped.

### 6.3 Ingestion

- One pipeline for all entry points: split → `deleteBySource(source)` →
  `embedTexts` → batched `HSET` (MULTI/EXEC). Idempotent by `_source`.
- **Startup indexing**: Next.js `instrumentation.ts` `register()` (runs once
  per server instance, before traffic; guard with
  `process.env.NEXT_RUNTIME === "nodejs"`, dynamic-import the pipeline).
  Wrap in try/catch — a down Redis or provider must not prevent boot; per-file
  failures must not abort remaining files.
- **Uploads** should be written into the same directory that startup indexing
  scans, so restarts converge to the same knowledge base.

### 6.4 Verification (do all of these, every time)

```bash
# after boot
redis-cli FT.INFO <index> | grep -A1 -E "^dim$|num_docs|hash_indexing_failures"
#   → dim == probed dim, num_docs == expected chunks, failures == 0

# ingestion across the batch boundary
#   upload a doc with >BATCH_SIZE sections; expect all chunks indexed

# dedup / idempotency
#   upload the same file twice; chunk count for that _source must not grow

# hostile filename
#   upload "my-file.v2.md" (hyphen + dots); must not 500

# provider switch / dim change simulation
#   FT.DROPINDEX without deleting keys, restart; expect clean rebuild with
#   exact expected doc count (no resurrection of stale hashes)
```

### 6.5 Operational invariants

- `hash_indexing_failures` must be 0 — alert on it if you have metrics.
- `num_docs` == number of keys under the prefix (modulo in-flight writes).
- A provider/model/dim change is destructive by design: expect a full
  re-embed; budget API quota accordingly.
- The dimension probe adds one embedding API call per cold start — negligible,
  but it means the embedding provider must be reachable at boot for *index
  creation*; an already-correct index short-circuits after the probe.

---

## 7. Quick Reference: Failure → Cause Table

| Observation | Likely cause | Fix |
|---|---|---|
| Writes OK, `num_docs=0`, `hash_indexing_failures>0` | vector byte length ≠ index DIM | probe dim, recreate index (§3) |
| `batch size is invalid` HTTP 400 on ingest | provider batch cap < SDK default (2048) | chunk `embedMany` inputs (§4) |
| `Syntax error at offset ...` on ingest/delete | unescaped TAG value (filename with `-`/`.`) | allow-list escaping (§5) |
| Duplicate chunks after index rebuild | FT.CREATE background rescan raced source-dedup search | wipe prefix keys on index (re)creation (§3) |
| Retrieval empty after switching provider | index still at old dim / old vectors | expected — wipe & re-embed, no compat layer |
| Works with tiny docs, fails on large ones | batch cap crossed only by many-chunk docs | test across batch boundary (§6.4) |
