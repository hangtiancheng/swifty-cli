# README 环境配置补充计划

- 日期：2026-07-12
- 目标文件：`apps/swifty-agent/README.md`
- 改动类型：纯追加（新增一个二级章节）

---

## 改动定位

在 `## Getting started` 章节的第 4 点「Start the MCP log server」之后、第 5 点「Install deps and run」之前，插入一段新的二级章节。

或者更清晰的做法：**整体将环境安装说明提升为独立的二级章节 `## Environment setup`**，并把它放在 `## Getting started` 之前。这样用户先装好依赖，再走 Getting started 流程，符合阅读顺序。

### 推荐结构

```
## Stack              （已有，保持不变）
## Environment setup  （新增 — 本次追加）
  ### Milvus
  ### Prometheus
  ### 验证环境
## Getting started    （已有，保持不变）
## APIs               （已有，保持不变）
## Notes              （已有，保持不变）
```

---

## 要追加的完整 markdown 内容

以下 markdown 将被插入到 `## Stack` 章节末尾之后、`## Getting started` 章节之前。

````markdown
## Environment setup

swifty-agent depends on two background services. **Milvus is required** (vector storage for RAG); **Prometheus is optional** (alert queries in the AI Ops pipeline).

### Milvus (Required)

Milvus has no official homebrew/apt formula — the recommended way across all platforms is Docker Compose via the official image.

#### macOS

Install Docker Desktop first:

```bash
brew install --cask docker
# Launch Docker.app, wait for the menu bar icon to appear
```

Run Milvus standalone:

```bash
mkdir -p ~/docker/milvus && cd ~/docker/milvus
curl -sfL https://github.com/milvus-io/milvus/releases/download/v2.4.17/milvus-standalone-docker-compose.yml \
  -o docker-compose.yml
docker compose up -d
```

Verify:

```bash
docker compose ps       # milvus-standalone should be "running"
docker compose logs -f etcd minio standalone  # check startup logs
```

#### Linux (Ubuntu / Debian)

```bash
# Install Docker Engine if not yet
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # re-login to take effect

# Run Milvus standalone
mkdir -p ~/docker/milvus && cd ~/docker/milvus
curl -sfL https://github.com/milvus-io/milvus/releases/download/v2.4.17/milvus-standalone-docker-compose.yml \
  -o docker-compose.yml
docker compose up -d
```

Verify:

```bash
docker compose ps
curl -sS http://localhost:9091/healthz    # expect "OK"
```

#### Windows WSL2

Enable WSL2 and install Docker Desktop with the WSL2 backend (Settings → Resources → WSL integration → enable your distro).

```powershell
# From an elevated PowerShell
wsl --install                                  # first-time setup (reboot required)
wsl --set-default-version 2
```

Then inside your WSL2 shell (Ubuntu recommended), follow the **Linux** steps above.
Docker commands inside WSL2 will route to Docker Desktop automatically.

> **Note on port mapping:** WSL2 uses a dynamic IP. Services bound to `localhost` inside WSL2 are reachable at `http://localhost:19530` from Windows (WSL2's localhost forwarding). If it doesn't work, use `$(hostname).local` or the IP from `ip a | grep eth0`.

#### (Optional) Attu — Milvus web UI

Attu is a dashboard to browse collections, view vectors, and debug indexing — highly recommended during development.

```bash
docker run -d --name attu \
  --network milvus \
  -p 8000:3000 \
  -e MILVUS_URL=standalone:19530 \
  zilliz/attu:v2.4
```

Open http://localhost:8000 to browse collections.

| Service            | Default port   | Health check                         |
| ------------------ | -------------- | ------------------------------------ |
| Milvus             | `19530` (gRPC) | `curl http://localhost:9091/healthz` |
| MinIO (internal)   | `9000`         | —                                    |
| etcd (internal)    | `2379`         | —                                    |
| Attu (optional UI) | `8000`         | http://localhost:8000                |

Default Milvus config in `.env`:

```bash
MILVUS_ADDRESS=localhost:19530
MILVUS_DB=agent
MILVUS_COLLECTION=biz
```

---

### Prometheus (Optional)

Prometheus is only used by the AI Ops pipeline's alert-query tool. If you don't use `POST /api/ai_ops`, you can skip this section.

#### macOS (homebrew)

```bash
brew install prometheus
brew services start prometheus
# Default config: /opt/homebrew/etc/prometheus.yml (Apple Silicon)
#                 /usr/local/etc/prometheus.yml      (Intel)
# Default port:   9090
```

Verify:

```bash
curl -sS http://localhost:9090/-/healthy     # expect "Prometheus Server is Healthy."
brew services info prometheus                # expect "started"
```

To stop or restart:

```bash
brew services stop prometheus
brew services restart prometheus
```

To edit the scrape config:

```bash
# Apple Silicon
code /opt/homebrew/etc/prometheus.yml
# Intel
code /usr/local/etc/prometheus.yml
brew services restart prometheus
```

#### Linux (Ubuntu / Debian)

Install from the official Prometheus tarball (recommended — gives you the latest version):

```bash
# Create a prometheus user
sudo useradd --no-create-home --shell /bin/false prometheus
sudo mkdir -p /etc/prometheus /var/lib/prometheus

# Download latest release (check https://prometheus.io/download/ for the current version)
PROM_VERSION=2.55.1
curl -sfL "https://github.com/prometheus/prometheus/releases/download/v${PROM_VERSION}/prometheus-${PROM_VERSION}.linux-amd64.tar.gz" \
  | tar -xz -C /tmp
sudo mv /tmp/prometheus-${PROM_VERSION}.linux-amd64/prometheus /usr/local/bin/
sudo mv /tmp/prometheus-${PROM_VERSION}.linux-amd64/promtool   /usr/local/bin/
sudo mv /tmp/prometheus-${PROM_VERSION}.linux-amd64/prometheus.yml /etc/prometheus/
sudo chown -R prometheus:prometheus /etc/prometheus /var/lib/prometheus

# Create a systemd service
sudo tee /etc/systemd/system/prometheus.service >/dev/null <<'EOF'
[Unit]
Description=Prometheus
Wants=network-online.target
After=network-online.target

[Service]
User=prometheus
Group=prometheus
Type=simple
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus/ \
  --web.console.templates=/etc/prometheus/consoles \
  --web.console.libraries=/etc/prometheus/console_libraries \
  --web.listen-address=:9090
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now prometheus
```

Verify:

```bash
sudo systemctl status prometheus          # expect "active (running)"
curl -sS http://localhost:9090/-/healthy  # expect "Prometheus Server is Healthy."
```

#### Windows WSL2

Inside your WSL2 shell, follow the **Linux** instructions above.

> **Firewall tip:** WSL2's `localhost` forwarding normally exposes port 9090 to Windows, so you can also visit http://localhost:9090 from a Windows browser to reach the Prometheus UI.

---

### Verify the environment

Run these checks before starting the app:

```bash
# Milvus (required)
curl -sS http://localhost:9091/healthz && echo " ✓ Milvus"

# Prometheus (optional)
curl -sS http://localhost:9090/-/healthy && echo " ✓ Prometheus"
```

Expected output when both are healthy:

```
OK ✓ Milvus
Prometheus Server is Healthy. ✓ Prometheus
```
````

---

## 对 `## Getting started` 的配套微调

现有第 2/3 点过于空泛，建议替换为指向 `## Environment setup` 的引用：

**替换前**

```
2. Ensure Milvus is running at `MILVUS_ADDRESS` (default `localhost:19530`).
3. (Optional) Start Prometheus at `PROMETHEUS_BASE_URL` for alert queries.
```

**替换后**

```
2. Install Milvus and optionally Prometheus — see [Environment setup](#environment-setup).
```

这样避免信息重复，且让 README 始终只引用一个权威章节。

---

## 实施步骤

| 步骤 | 操作                                                                                            | 验证点                                      |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1    | 在 `## Stack` 章节之后、`## Getting started` 章节之前，插入上述 `## Environment setup` 完整内容 | 章节层级正确（`###` 是平台子节）            |
| 2    | 把 `## Getting started` 中的第 2/3 点合并为单条引用                                             | 编号连贯（1 → 2 → 3 → 4）                   |
| 3    | 通读 README 一遍，确保链接和章节锚点可跳转                                                      | GitHub 渲染后锚点 `#environment-setup` 可用 |

---

## 说明

- 所有 curl 链接均使用 Milvus 官方 GitHub Releases + Docker Hub 镜像（`milvusdb/milvus` / `zilliz/attu`），不依赖任何私有 registry。
- Milvus 版本锁定为 `v2.4.17`（LTS）；升级时只需替换 URL 中的版本号。
- Prometheus 版本采用 `2.55.1`（截至 2026-07 最新稳定版）。
- Attu UI 标注为 (Optional) 但强烈推荐，便于排查向量库问题。
- WSL2 章节特别说明了 localhost 转发问题（常见问题之一）。
