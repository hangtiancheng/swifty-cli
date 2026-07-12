# Swifty Agent

AI intelligent OnCall assistant by Next.js 16 App Router + Vercel AI SDK.

## setup

### Milvus

Milvus is the vector database used for RAG knowledge base storage.

#### macOS

```bash
# Using Homebrew (recommended)
brew install milvus

# Start Milvus standalone
milvus-server
```

Alternatively, use Docker:

```bash
docker run -d --name milvus-standalone \
  -p 19530:19530 \
  -p 9091:9091 \
  milvusdb/milvus:latest standalone
```

#### Linux

Using Docker (recommended):

```bash
# Download docker-compose
wget https://github.com/milvus-io/milvus/releases/download/v2.4.0/milvus-standalone-docker-compose.yml -O docker-compose.yml

# Start
docker compose up -d

# Verify
docker compose ps
```

Or install via apt/yum using the official Milvus package — see https://milvus.io/docs/install_standalone-linux.md.

#### Windows WSL2

```bash
# Inside your WSL2 distro, use Docker
docker run -d --name milvus-standalone \
  -p 19530:19530 \
  -p 9091:9091 \
  milvusdb/milvus:latest standalone
```

WSL2's localhost forwarding automatically exposes port 19530 to Windows, so `MILVUS_ADDRESS=localhost:19530` works without changes.

#### Verify Milvus

```bash
# Check if Milvus is reachable
curl http://localhost:19530/v1/vector/collections
```

Default address: `localhost:19530`. The app uses database `agent`, collection `biz` — these are created automatically on first use.

---

### Prometheus

Prometheus is used for metrics collection and alert queries (optional).

#### macOS

```bash
brew install prometheus
brew services start prometheus
```

Default address: `http://localhost:9090`.

#### Linux

```bash
# Download
wget https://github.com/prometheus/prometheus/releases/download/v2.53.0/prometheus-2.53.0.linux-amd64.tar.gz
tar xvf prometheus-2.53.0.linux-amd64.tar.gz
cd prometheus-2.53.0.linux-amd64

# Run
./prometheus --config.file=prometheus.yml
```

Or via Docker:

```bash
docker run -d --name prometheus \
  -p 9090:9090 \
  prom/prometheus:latest
```

#### Windows WSL2

```bash
# Inside WSL2
docker run -d --name prometheus \
  -p 9090:9090 \
  prom/prometheus:latest
```

Same as Milvus, port 9090 is auto-forwarded to Windows localhost.

#### Verify Prometheus

```bash
curl http://localhost:9090/-/healthy
```

---

### Docker Compose (recommended)

The fastest way to start both Milvus and Prometheus together. Create `docker-compose.yml` in the project root:

```yaml
services:
  milvus:
    image: milvusdb/milvus:latest
    container_name: milvus-standalone
    command: ["milvus", "run", "standalone"]
    ports:
      - "19530:19530"
      - "9091:9091"
    environment:
      ETCD_USE_EMBED: "true"
      ETCD_DATA_DIR: /var/lib/milvus/etcd
    volumes:
      - milvus_data:/var/lib/milvus
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9091/healthz"]
      interval: 30s
      start_period: 90s
      timeout: 20s
      retries: 3

  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    ports:
      - "9090:9090"
    volumes:
      - prometheus_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.path=/prometheus"
      - "--web.console.libraries=/etc/prometheus/console_libraries"
      - "--web.console.templates=/etc/prometheus/consoles"
      - "--web.enable-lifecycle"

volumes:
  milvus_data:
  prometheus_data:
```

Then start:

```bash
docker compose up -d

# Verify both services
docker compose ps
curl http://localhost:19530/v1/vector/collections   # Milvus
curl http://localhost:9090/-/healthy                # Prometheus

# Stop
docker compose down

# Stop and remove data volumes
docker compose down -v
```

This works identically on macOS, Linux, and Windows WSL2 (Docker Desktop required).

---

## APIs

- `POST /api/chat` — non-streaming chat
- `POST /api/chat_stream` — SSE streaming chat
- `POST /api/upload` — upload a file (.txt/.md) to the knowledge base
- `POST /api/ai_ops` — AI Ops plan-execute-replan

## Notes

- On first use, upload a doc file via the "..." menu so the RAG knowledge base has content; otherwise retrieval returns empty.
- Embeddings are stored as BinaryVector (float32 bytes reinterpreted as binary, HAMMING metric), matching the source project.
- Tool definitions follow a three-layer split: `schemas.ts` (zod) → `operations.ts` (pure functions) → `index.ts` (AI SDK `tool` wrapper).
