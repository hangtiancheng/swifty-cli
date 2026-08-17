# Swifty Agent

AI intelligent OnCall assistant by Next.js 16 App Router + Vercel AI SDK.

## setup

### Redis Stack (Vector DB)

Requires Redis Stack (includes the RediSearch module for vector search).

**Option A: Docker (recommended)**

```bash
docker compose up redis -d
```

**Option B: Homebrew (macOS)**

Install (cask, includes RediSearch module):

```bash
brew tap redis-stack/redis-stack
brew install --cask redis-stack
```

If the plain `redis` formula is running, stop it first (both use port 6379):

```bash
brew services stop redis
```

Start Redis Stack in the background (casks are not managed by `brew services`):

```bash
redis-stack-server --daemonize yes
```

Default port: `6379`. RedisInsight UI: `http://localhost:8001`.

### Prometheus & Grafana (monitoring, optional)

**Option A: Docker**

```bash
docker compose up prometheus grafana -d
```

**Option B: Homebrew (macOS)**

```bash
brew install prometheus grafana
brew services start prometheus
brew services start grafana
```

Prometheus default port: `9090`. Grafana default port: `3000` (admin / pass).

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

`/opt/homebrew/etc/prometheus.yml`

```yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /opt/homebrew/etc/prometheus.rules.yml

scrape_configs:
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]
```

`/opt/homebrew/etc/prometheus.rules.yml`

```yml
# Demo alerting rules for the swifty-agent AI Ops flow.
# expr: vector(1) is always true, so these alerts fire without any real
# metrics. Alert names match docs/alert-handling-guide.md so the
# query_internal_docs RAG step finds the corresponding handling procedures.
groups:
  - name: swifty-agent-demo
    interval: 15s
    rules:
      - alert: ServiceOffline
        expr: vector(1)
        for: 0s
        labels:
          severity: critical
          service: checkout
        annotations:
          summary: Service Offline
          description: "Service checkout is offline: pod restarts detected after panic (demo alert)."

      - alert: HighInterfaceFailureRate
        expr: vector(1)
        for: 0s
        labels:
          severity: warning
          service: order-api
        annotations:
          summary: High Interface Failure Rate
          description: "Interface failure rate above 5% on service order-api for 10m (demo alert)."
```
