# SwiftyCode RUNBOOK

Operations and troubleshooting guide for the SwiftyCode daemon.

---

## Daemon Lifecycle

### Start the Daemon

```bash
swifty core start          # Start in background
pnpm dev:core              # Start in foreground (development)
```

The daemon listens on `127.0.0.1:7437` by default. It creates a PID file at `~/.swifty/swifty-core.pid`.

### Check Daemon Status

```bash
swifty core status
swifty ping
# → pong server=0.0.1 uptime=1234ms latency=2ms
```

### Stop the Daemon

```bash
swifty core stop           # Graceful shutdown (SIGTERM)
kill "$(cat ~/.swifty/swifty-core.pid)"   # Manual fallback
```

On shutdown, the daemon:

1. Aborts all running agent runs via `AbortController`
2. Waits up to 5 seconds for runs to settle
3. Closes all MCP server connections
4. Stops the TCP server
5. Flushes the trace writer

### Port Conflict Resolution

```bash
# Check what's using the port
lsof -i :7437

# Use a different port
SWIFTY_PORT=8000 swifty core start
```

---

## Configuration

### 5-Tier Priority Chain (later tiers override earlier ones)

1. **Built-in defaults** (hardcoded)
2. **Global TOML** (`~/.swifty/config.toml`)
3. **Project-local TOML** (`.swifty/config.toml`)
4. **dotenv** (`.env` file in current directory)
5. **Environment variables** (`SWIFTY_*` prefix)

### TOML Validation

Unknown keys and type mismatches cause immediate exit with a descriptive error:

```
Config error: Unknown [core] keys: hostname
Config error: core.port must be an integer
Config error: compaction.auto_threshold must be between 0 and 1
```

### Environment Variables

| Variable                           | Default                         | Description                                           |
| ---------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY`                | (required)                      | Anthropic API key                                     |
| `ANTHROPIC_BASE_URL`               | (SDK default)                   | Override API base URL                                 |
| `SWIFTY_CONFIG`                    | `~/.swifty/config.toml`         | Path to TOML config file                              |
| `SWIFTY_HOST`                      | `127.0.0.1`                     | Daemon bind host                                      |
| `SWIFTY_PORT`                      | `7437`                          | Daemon bind port                                      |
| `SWIFTY_LOG_LEVEL`                 | `INFO`                          | Log level (DEBUG / INFO / WARN / ERROR)               |
| `SWIFTY_LOG_FILE`                  | `~/.swifty/logs/core.log`       | Log file path                                         |
| `SWIFTY_LOG_FORMAT`                | `text`                          | Log format (text / json)                              |
| `SWIFTY_MAX_STEPS`                 | `20`                            | Maximum agent loop steps                              |
| `SWIFTY_LLM_DEFAULT_MODEL`         | `claude-sonnet-4-6`             | Default LLM model                                     |
| `SWIFTY_TRACE_ENABLED`             | `true`                          | Enable/disable tracing                                |
| `SWIFTY_TRACE_FILE`                | `~/.swifty/traces/daemon.jsonl` | Trace file path                                       |
| `SWIFTY_TRACE_INCLUDE_LLM_PAYLOAD` | `true`                          | Include full LLM payloads in traces                   |
| `SWIFTY_PERMISSION_TIMEOUT_S`      | `60`                            | Permission prompt timeout (seconds)                   |
| `SWIFTY_COMPACT_THRESHOLD`         | `0.0`                           | Auto-compaction threshold (0.0 = disabled, 0.8 = 80%) |
| `SWIFTY_COMPACT_TOOL_LIMIT`        | `8000`                          | Tool result truncation limit (chars)                  |
| `SWIFTY_COMPACT_TOOL_KEEP`         | `4000`                          | Tool result keep size (chars)                         |

---

## Error Codes

### Session Errors

| Code   | Name                   | Cause                              | Resolution                                 |
| ------ | ---------------------- | ---------------------------------- | ------------------------------------------ |
| -32010 | SESSION_NOT_FOUND      | Session ID does not exist          | Create a new session with `session.create` |
| -32011 | SESSION_CLOSED         | Session is already closed          | Create a new session                       |
| -32012 | SESSION_BUSY           | Another message is being processed | Wait for the current run to finish         |
| -32020 | PROVIDER_NOT_AVAILABLE | No LLM provider configured         | Set `ANTHROPIC_API_KEY`                    |
| -32021 | COMPACTION_FAILED      | LLM-driven compaction failed       | Retry `/compact` or check API key          |

### JSON-RPC Standard Errors

| Code   | Name             | Cause                                  |
| ------ | ---------------- | -------------------------------------- |
| -32700 | PARSE_ERROR      | Malformed JSON in request line         |
| -32600 | INVALID_REQUEST  | JSON-RPC envelope validation failed    |
| -32601 | METHOD_NOT_FOUND | Unknown method name                    |
| -32602 | INVALID_PARAMS   | Parameter validation failed (ZodError) |
| -32603 | INTERNAL_ERROR   | Unhandled exception in handler         |

---

## Troubleshooting

### Connection Refused

```
error: core not running (127.0.0.1:7437)
```

The daemon is not running. Start it with `swifty core start` or `pnpm dev:core`.

### Permission Timeout

If a permission prompt is not answered within `SWIFTY_PERMISSION_TIMEOUT_S` (default 60s), the tool invocation fails with `permission_denied` and decision `timeout`. The agent receives an error and may retry or choose an alternative approach.

To resolve:

- Increase `SWIFTY_PERMISSION_TIMEOUT_S` for longer prompts
- Respond to permission prompts promptly in the TUI
- Use `always_allow` to pre-approve trusted tools

### MCP Server Startup Failure

MCP server failures are non-fatal — the daemon starts without the failed server's tools. Check the log for:

```
mcp: server 'my-server' failed to start, skipping
```

Common causes:

- `command` not found or not executable
- MCP server process exits immediately
- Network unreachable for TCP transport
- Protocol version mismatch

Debug with:

```bash
SWIFTY_LOG_LEVEL=DEBUG swifty core start
# Watch for "mcp stderr:" lines in the log
```

### LLM API Errors

The Anthropic provider retries up to 3 times on transient network errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT, EPIPE, EAI_AGAIN) with 1s/2s/4s backoff. After exhausting retries, the run fails with `llm_error`.

Common causes:

- Invalid API key → `ANTHROPIC_API_KEY` not set or expired
- Rate limiting → Wait and retry
- Network issues → Check connectivity to Anthropic API

---

## Tracing

The trace log is written to `~/.swifty/traces/daemon.jsonl` in NDJSON format.

### Trace Directions

| Direction     | Color   | Meaning                                     |
| ------------- | ------- | ------------------------------------------- |
| `CLIENT→CORE` | cyan    | Client sent a command to the daemon         |
| `CORE→CLIENT` | yellow  | Daemon sent a response or event to a client |
| `CORE`        | green   | Internal daemon operation                   |
| `CORE→LLM`    | magenta | LLM API request                             |
| `LLM→CORE`    | blue    | LLM API response                            |

### Trace Layers

| Layer   | Description                     |
| ------- | ------------------------------- |
| `ipc`   | JSON-RPC commands and responses |
| `event` | EventBus pub/sub events         |
| `llm`   | LLM API interactions            |

### Trace Kinds

| Kind           | Layer | Description                  |
| -------------- | ----- | ---------------------------- |
| `command`      | ipc   | Incoming JSON-RPC request    |
| `response`     | ipc   | Successful JSON-RPC response |
| `error`        | ipc   | JSON-RPC error response      |
| `push`         | ipc   | Event pushed to subscriber   |
| `event`        | event | Internal EventBus event      |
| `api_call`     | llm   | LLM API request              |
| `api_response` | llm   | LLM API response             |

### Using `swifty trace`

```bash
swifty trace                          # View all trace records
swifty trace --follow                 # Tail mode (live updates)
swifty trace --raw                    # Raw NDJSON output (for piping)
swifty trace --layer llm              # Filter by layer (ipc / event / llm)
swifty trace --direction CORE→LLM     # Filter by direction
swifty trace run-abc123               # Filter by run ID
```

---

## Session and Compaction

### Session Modes

- `one_shot`: Single-goal execution. Session closes automatically after the agent completes.
- `chat`: Multi-turn interactive sessions. Messages persist to `thread.jsonl` across turns.

### Manual Compaction

In the TUI, type `/compact` to trigger context compaction. This:

1. Sends the full conversation history to the LLM for summarization
2. Replaces the thread with `[summary, acknowledgment]`
3. Backs up the original thread to `thread_<timestamp>.jsonl.bak`
4. Writes a summary file to `summary_<timestamp>.md`

### Auto-Compaction

Set `SWIFTY_COMPACT_THRESHOLD` (or `compaction.auto_threshold` in TOML) to a value between 0.0 and 1.0. When the context usage percentage exceeds this threshold after a tool-use step, compaction triggers automatically.

- `0.0` (default): Auto-compaction disabled — use manual `/compact`
- `0.8`: Compact when context reaches 80% of the model's window

### Context Waterline

The TUI status bar shows the current context percentage. The color changes based on usage:

- `< 70%`: Normal (dim)
- `70%–85%`: Warning (yellow)
- `> 85%`: Critical (red) — compaction recommended

---

## Data Directories

| Path                                     | Purpose                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `~/.swifty/config.toml`                  | Global configuration                                                  |
| `~/.swifty/policy.toml`                  | Persistent permission policies                                        |
| `~/.swifty/sessions/`                    | Session data: `meta.json`, `thread.jsonl`, `notes.md`, `summary_*.md` |
| `~/.swifty/sessions/{sid}/runs/{runId}/` | Per-run event logs (`events.jsonl`)                                   |
| `~/.swifty/traces/daemon.jsonl`          | Trace log (NDJSON)                                                    |
| `~/.swifty/logs/core.log`                | Application log (Pino)                                                |
| `~/.swifty/context.md`                   | Global context injected into agent system prompts                     |
| `~/.swifty/swifty-core.pid`              | Daemon PID file                                                       |
| `.swifty/config.toml`                    | Project-local configuration                                           |
| `.swifty/context.md`                     | Project-local context                                                 |

---

## Development

```bash
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint --fix
pnpm test               # vitest run
pnpm format             # oxfmt --write
pnpm qa                 # All of the above combined
pnpm doc                # Regenerate WIRE_PROTOCOL.md
```
