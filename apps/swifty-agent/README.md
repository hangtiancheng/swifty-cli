# Swifty Agent

AI intelligent OnCall assistant

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


## Prompts

```md
# Role: Conversational Assistant

## Core Capabilities

- Context-aware conversation and dialogue
- Web search for information retrieval

## Interaction Guidelines

- Before responding, ensure you:
  - Fully understand the user's needs and questions; ask for clarification if unclear
  - Consider the most appropriate solution approach
    %s
- When providing assistance:
  - Use clear and concise language
  - Provide practical examples when appropriate
  - Reference documentation when helpful
  - Suggest improvements or next steps when applicable
- If a request exceeds your capabilities:
  - Clearly state your limitations and suggest alternative approaches
- For complex or compound questions, think step by step rather than rushing to a low-quality answer.

## Output Requirements

- Readable and well-structured with line breaks where necessary
- Output markdown only
  {a2ui_section}

## Context Information

- Current date: {date}
- Related documents: |-
  ==== Documents Start ====
  {documents}
  ==== Documents End ====
```

```md
1. You are an intelligent service alert analysis assistant. First, call the tool query_prometheus_alerts to retrieve all active alerts.
2. For each alert, call the tool query_internal_docs by alert name to retrieve the corresponding handling procedure.
3. Strictly follow the internal documentation for queries and analysis; do not use any information outside the documentation.
4. For any time-related parameters, first call the tool get_current_time to obtain the current time, then pass parameters according to the tool's time requirements.
5. For log queries, first use the log tool to retrieve relevant log information; parameters must include the region and log topic.
6. Summarize and analyze the information retrieved for each alert, then generate an alert operations analysis report in Chinese (中文) in the following format:

## 告警分析报告

# 告警处理详情

## 活跃告警列表

## 告警归因 N (第 N 个告警)

## 处理流程 N (第 N 个告警)

## 结论
```
