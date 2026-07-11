# SwiftyCode

A dual-process local AI agent system written in TypeScript. SwiftyCode runs an LLM-powered agent daemon that executes shell commands, reads and writes files, manages tasks, coordinates sub-agents, and integrates with external tools via the Model Context Protocol (MCP). Clients connect over a JSON-RPC 2.0 protocol on TCP, with both a terminal UI (React + Ink) and a command-line interface provided out of the box.

## Table of Contents

- [Architecture](#architecture)
- [Core Subsystems](#core-subsystems)
  - [Agent Loop](#agent-loop)
  - [LLM Provider](#llm-provider)
  - [Tool System](#tool-system)
  - [Permission System](#permission-system)
  - [Session Management](#session-management)
  - [Context Compaction](#context-compaction)
  - [Sub-Agent Orchestration](#sub-agent-orchestration)
  - [Skills](#skills)
  - [Agent Profiles](#agent-profiles)
  - [Task Management](#task-management)
  - [MCP Integration](#mcp-integration)
  - [Tracing](#tracing)
  - [Event System](#event-system)
  - [Transport Layer](#transport-layer)
- [Terminal UI](#terminal-ui)
- [CLI Reference](#cli-reference)
- [Configuration](#configuration)
  - [5-Tier Priority Chain](#5-tier-priority-chain)
  - [TOML Configuration](#toml-configuration)
  - [Environment Variables](#environment-variables)
- [JSON-RPC Protocol](#json-rpc-protocol)
  - [Commands](#commands)
  - [Events](#events)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Development](#development)
  - [Test Coverage](#test-coverage)
  - [Coding Standards](#coding-standards)
- [Data Directories](#data-directories)
- [License](#license)

---

## Architecture

SwiftyCode follows a daemon + client architecture. The core daemon is a long-running process that manages sessions, permissions, LLM interactions, tool execution, and tracing. Clients (TUI or CLI) connect over TCP using newline-delimited JSON-RPC 2.0.

```
                         TCP (JSON-RPC 2.0 / NDJSON)
   CLI / TUI    <--------------------------------------->    Daemon (swifty-core)
    (client)             localhost:7437                        |
                                                               ├── SocketServer (TCP, 64 MB frame limit)
                                                               ├── IpcEventBroadcaster (topic-based pub/sub)
                                                               ├── SessionManager
                                                               │     ├── PromiseMutex (per-session concurrency control)
                                                               │     ├── SkillLoader (3-tier resolution)
                                                               │     └── AgentRunner
                                                               │           ├── AgentLoop (plan-act-observe)
                                                               │           ├── ToolRegistry
                                                               │           │     ├── bash, read_file, write_file, list_dir
                                                               │           │     ├── note_save
                                                               │           │     ├── task_create, task_get, task_list, task_update
                                                               │           │     ├── spawn_agent, agent_result
                                                               │           │     └── MCP tools (dynamically discovered)
                                                               │           ├── Compactor (LLM-driven context compression)
                                                               │           ├── TracingProvider (decorator)
                                                               │           └── TaskManager (file-based CRUD)
                                                               ├── PermissionManager (6-tier policy evaluation)
                                                               ├── McpServerManager (multi-server lifecycle)
                                                               ├── TraceWriter (synchronous NDJSON)
                                                               └── EventBus (in-process pub/sub)
```

The separation of daemon and client provides several advantages: the daemon persists across client disconnections, multiple clients can observe the same session via event subscriptions, and the LLM API key lives only in the daemon process.

---

## Core Subsystems

### Agent Loop

The `AgentLoop` class implements a plan-act-observe loop that drives the agent:

1. **Plan**: Call the LLM with the current conversation history, available tool schemas, and system prompt (assembled from base prompt, global context, project context, and session notes).
2. **Act**: Execute each tool call returned by the LLM through the full invocation pipeline (validation, permission check, execution with timeout, retry on transient failures).
3. **Observe**: Append tool results to the conversation history and evaluate termination conditions.

**Termination conditions** (checked in order each iteration):

| Condition                       | Status  | Reason               |
| ------------------------------- | ------- | -------------------- |
| `AbortSignal` aborted           | failed  | `cancelled`          |
| LLM returns `end_turn`          | success | --                   |
| Step counter reaches `maxSteps` | failed  | `exceeded_max_steps` |
| LLM provider throws unhandled   | failed  | `llm_error`          |

**Auto-compaction**: When the estimated context usage (as a percentage of the model's context window) exceeds the configured threshold (default 0.0, meaning disabled), the loop invokes the `Compactor` to summarize the conversation history in-place before the next iteration.

**max_tokens handling**: When the LLM returns `max_tokens` alongside pending tool calls, the loop injects an error tool result informing the LLM that the output was truncated, allowing it to recover and continue.

### LLM Provider

The `AnthropicProvider` class wraps the Anthropic Messages API with streaming, retry, and prompt caching:

- **Streaming**: Uses the `messages.stream()` endpoint. Text deltas are emitted as `llm.token` events in real time. Thinking blocks (extended thinking) are captured and returned alongside text and tool use blocks.
- **Prompt caching**: The system prompt and the last tool schema carry `cache_control: { type: "ephemeral" }` markers, enabling Anthropic's prompt caching to reduce latency and cost on subsequent calls.
- **Retry with exponential backoff**: On transient network errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT, EPIPE, EAI_AGAIN, socket hang up, connection reset), the provider retries up to 3 times with delays of 1s, 2s, and 4s. Non-retryable errors (authentication failures, 400 Bad Request) are thrown immediately.
- **Model context windows**: All Claude models are mapped to a 200,000-token context window for compaction threshold calculations.
- **max_tokens**: Set to 8,192 per request.
- **Dependency injection**: The constructor accepts an optional `Anthropic` client instance, enabling test doubles without monkey-patching.

### Tool System

The tool system provides a uniform interface for all agent capabilities:

**`BaseTool` interface**:

- `name`: Unique tool identifier (snake_case).
- `description`: Human-readable description sent to the LLM.
- `inputSchema`: JSON Schema object describing the tool's parameters (used by the LLM for structured output).
- `paramsModel` (optional): Zod schema for runtime parameter validation.
- `invoke(params)`: Async function returning a `ToolResult`.

**`ToolResult`**:

- `content`: String output (success message or error description).
- `isError`: Boolean flag.
- `errorType`: One of `runtime_error`, `timeout`, `schema_error`, `permission_denied` (null on success).

**Invocation pipeline** (`invokeTool()`):

```
params ──> Zod validation ──> permission check ──> timeout-wrapped invoke ──> retry logic ──> ToolResult
              │                    │                      │                      │
         schema_error      permission_denied          timeout           runtime_error / rate_limited
```

- **Zod validation**: If the tool defines a `paramsModel`, invalid parameters produce a `schema_error` without invoking the tool.
- **Permission check**: Calls `PermissionManager.checkAndWait()`, which may block until the user responds to a permission prompt.
- **Timeout**: Tool invocations are wrapped in a `Promise.race` with a configurable timeout (default 120s).
- **Retry**: On `runtime_error` or `rate_limited`, the invocation retries up to 2 times with exponential backoff (2s base). `schema_error`, `timeout`, and `permission_denied` are never retried.
- **No-throw guarantee**: `invokeTool()` never throws. All errors are converted to `ToolResult` with `isError: true`.

#### Built-in Tools

| Tool           | Description                                                                                             | Limits                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `bash`         | Execute shell commands via `sh -c`. Returns combined stdout+stderr.                                     | Timeout: default 60s, max 120s. Output: 64 KB. SIGKILL on timeout. |
| `read_file`    | Read file contents with synchronous I/O.                                                                | 512 KB truncation. Path traversal protection (rejects `..`).       |
| `write_file`   | Write file contents, creating parent directories as needed.                                             | 1 MB content limit. Path traversal protection.                     |
| `list_dir`     | Recursive directory listing in tree format with Unicode connectors.                                     | Max depth: 4. Max entries: 200. Path traversal protection.         |
| `note_save`    | Persist durable facts to session notes (visible in future turns).                                       | Requires active session context.                                   |
| `task_create`  | Create a tracked task with optional dependency list (`blocked_by`).                                     | --                                                                 |
| `task_get`     | Retrieve full task details by integer ID.                                                               | --                                                                 |
| `task_list`    | List all tasks with status and dependency information.                                                  | --                                                                 |
| `task_update`  | Update task status or dependency lists. Completing a task auto-clears it from dependents' `blocked_by`. | --                                                                 |
| `spawn_agent`  | Spawn an isolated sub-agent (foreground or background). Supports agent profile selection.               | Nesting limit: depth 2.                                            |
| `agent_result` | Query the status and result of a background sub-agent.                                                  | --                                                                 |

### Permission System

Every tool invocation passes through a 6-tier permission evaluation:

| Tier | Source                 | Scope     | Behavior                                                                                          |
| ---- | ---------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| 1    | `deny_patterns`        | bash only | Regex match on command string. Auto-deny.                                                         |
| 2    | OUTSIDE_CWD heuristics | bash only | 6 regex patterns detecting absolute paths, `~`, `..`, `$HOME`, `$PWD`, `cd` commands. Forces ASK. |
| 3    | Session cache          | all tools | In-memory per-session `always_allow` / `always_deny` map.                                         |
| 4    | Persistent cache       | all tools | `~/.swifty/policy.toml` always-allow/deny entries. Survives daemon restarts.                      |
| 5    | `allow_patterns`       | bash only | Regex match on command string. Auto-allow.                                                        |
| 6    | Tool default           | all tools | Static policy: bash=ASK, write_file=ASK, read_file=ALLOW, list_dir=ALLOW, note_save=ALLOW.        |

**ASK flow**: When the evaluation reaches ASK, the `PermissionManager` creates a pending promise, emits a `permission.requested` event (with tool name, parameter preview, and session context), and blocks until the user responds or the timeout expires (default 60s).

**Decisions**:

- `allow_once`: Allow this single invocation.
- `deny_once`: Deny this single invocation.
- `always_allow`: Allow and persist to both session cache and `policy.toml`.
- `always_deny`: Deny and persist to both session cache and `policy.toml`.

**Session isolation**: `cancelSession()` rejects all pending permission requests for a specific session (e.g., on disconnect), without affecting other sessions.

### Session Management

The `SessionManager` manages the lifecycle of agent sessions:

**Session modes**:

- `one_shot`: Single-goal execution. The session closes automatically after the agent completes.
- `chat`: Multi-turn interactive sessions. Messages are persisted to `thread.jsonl` and survive across turns.

**Session lifecycle**:

1. `session.create` allocates a new session with a UUID-based ID (`session-{12chars}`).
2. `session.send_message` acquires a per-session mutex, appends the user message, resolves skill invocations (if the message starts with `/`), creates an `AgentRunner`, and executes the agent loop.
3. `session.get_history` returns the persisted message history.
4. `session.close` marks the session as closed.
5. `session.compact` triggers manual context compaction.

**Concurrency control**: A `PromiseMutex` enforces mutual exclusion per session. If a second `send_message` arrives while the first is still processing, it is rejected immediately with `SESSION_BUSY` (-32012). The mutex supports both blocking `acquire()` (FIFO queue) and non-blocking `tryAcquire()` (immediate rejection).

**Skill resolution**: When a message starts with `/skillName args`, the `SessionManager` resolves the skill via the `SkillLoader`, renders the prompt template (replacing `$ARGUMENTS` with user input), and optionally overrides the system prompt and restricts the available tool set.

**Error codes**:

| Code   | Name                   | Meaning                            |
| ------ | ---------------------- | ---------------------------------- |
| -32010 | SESSION_NOT_FOUND      | No session with the given ID       |
| -32011 | SESSION_CLOSED         | Session is already closed          |
| -32012 | SESSION_BUSY           | Another message is being processed |
| -32020 | PROVIDER_NOT_AVAILABLE | No LLM provider configured         |
| -32021 | COMPACTION_FAILED      | LLM-driven compaction failed       |

### Context Compaction

The `Compactor` class performs LLM-driven conversation summarization to manage context window usage:

**Structured summary format** (6 sections):

1. **Original Goal**: One-sentence description of the user's objective.
2. **Completed Steps**: Specific actions taken (file paths, commands, decisions).
3. **Key Constraints and Discoveries**: Facts learned during the run that affect future decisions.
4. **Current File State**: Path and one-line description for each created or modified file.
5. **Remaining TODOs**: Ordered list of outstanding work items.
6. **Critical Data**: Verbatim values the next LLM needs (IDs, tokens, exact error messages, config values).

**Two modes of operation**:

- `compact()`: In-place replacement of `ExecutionContext.messages` with `[summary, acknowledgment]`. Writes a summary file to the session directory. Publishes `context.compacted` event.
- `compactMessages()`: Pure functional compression. Returns a `CompactionResult` or null on failure. Uses a silent `EventBus` to avoid polluting the parent event stream.

**Token estimation**: Uses a `chars / 4` approximation for both input and output token counting.

**Tool result truncation** (budget management): Before compaction, oversized tool results in the message history are truncated to `tool_result_limit` characters (default 8,000), keeping the first `tool_result_keep` characters (default 4,000) and appending a `[truncated N chars]` marker.

### Sub-Agent Orchestration

SwiftyCode supports spawning isolated child agents for parallel or delegated work:

**`SpawnAgentTool`**:

- Creates a clean `ExecutionContext` with only the provided prompt (no parent history leakage).
- Supports two execution modes:
  - **Foreground**: Blocks until the child agent completes. Returns the full result.
  - **Background**: Returns immediately with a `run_id`. The result is retrieved later via `agent_result`.
- Child events are bridged to the parent `EventBus` via `subagent.started` and `subagent.finished` events.
- **Nesting limit**: Depth >= 2 returns an error, preventing unbounded recursion.
- **Tool whitelist**: The child agent's tool registry is restricted to the tools specified in the agent profile's `allowed_tools` list.

**`AgentResultTool`**:

- Queries the `BackgroundTaskRegistry` for a sub-agent's status.
- Returns "still running" for pending agents, the full result for completed agents, or an error for failed agents.

**Built-in multi-agent workflow** (via the `orchestrate` skill):

1. **Planner**: Analyzes the objective and produces a numbered execution plan.
2. **Executor**: Carries out the plan step by step.
3. **Reviewer**: Verifies execution results against the original objective.

### Skills

Skills are Markdown files with YAML frontmatter that define reusable agent workflows:

```yaml
---
name: skill_name
description: What the skill does
allowed_tools:
  - tool_a
  - tool_b
---
System prompt template. Use $ARGUMENTS as a placeholder for user input.
```

**3-tier resolution** (first match wins):

1. Project-local: `.swifty/skills/{name}.md` or `.swifty/skills/{name}/SKILL.md`
2. User-global: `~/.swifty/skills/{name}.md` or `~/.swifty/skills/{name}/SKILL.md`
3. Built-in: Bundled with the application

#### Built-in Skills

| Skill         | Description                                                               | Allowed Tools                                                            |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `init`        | Analyze the current project and generate `.swifty/context.md`             | `read_file`, `list_dir`, `write_file`, `bash`                            |
| `orchestrate` | Three-stage planner-executor-reviewer multi-agent workflow                | `spawn_agent`, `agent_result`, `task_create`, `task_update`, `task_list` |
| `review`      | Code review with three severity tiers (critical / recommended / optional) | `read_file`, `list_dir`, `bash`                                          |
| `summarize`   | Compress session conversation into a readable summary                     | `note_save`                                                              |

### Agent Profiles

Agent profiles are TOML files that define specialized agent roles:

```toml
[agent]
description = "Role description"
system_prompt = """Multi-line system prompt"""
allowed_tools = ["read_file", "list_dir"]
model = "claude-sonnet-4-6"
```

**3-tier resolution**: Same search order as skills (project-local > user-global > built-in).

#### Built-in Agent Profiles

| Profile    | Role                                           | Allowed Tools                                                             | Model             |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------------- | ----------------- |
| `planner`  | Read-only goal analysis and task decomposition | `read_file`, `list_dir`, `task_create`, `task_update`                     | claude-sonnet-4-6 |
| `executor` | Step-by-step plan execution                    | `bash`, `read_file`, `write_file`, `list_dir`, `task_update`, `task_list` | claude-sonnet-4-6 |
| `reviewer` | Result verification and quality assessment     | `read_file`, `list_dir`, `bash`                                           | claude-sonnet-4-6 |

### Task Management

The `TaskManager` provides file-based task persistence with dependency tracking:

- **Storage**: Each task is persisted as `task_{id}.json` in a `.tasks/` directory.
- **Auto-incrementing IDs**: Integer IDs assigned sequentially.
- **Bidirectional dependencies**: Tasks maintain both `blockedBy` (upstream) and `blocks` (downstream) arrays.
- **Auto-cleanup**: Completing a task automatically removes it from other tasks' `blockedBy` lists.
- **Status lifecycle**: `pending` -> `in_progress` -> `completed`.

### MCP Integration

SwiftyCode integrates with external tool servers via the Model Context Protocol (MCP):

**`McpClient`**:

- Full JSON-RPC 2.0 client supporting both `stdio` (subprocess) and `tcp` transports.
- MCP protocol version: `2024-11-05`.
- `PromiseQueue` serializes concurrent JSON-RPC calls to prevent interleaving.
- 30-second read timeout per line.
- Graceful subprocess termination: SIGTERM followed by SIGKILL after a 5-second grace period.

**`McpServerManager`**:

- Manages the lifecycle of multiple MCP server connections.
- On startup, connects to each configured server sequentially, discovers available tools via `tools/list`, and caches them for registry injection.
- Failed servers are logged and skipped (non-fatal).

**`McpTool`**:

- Wraps an MCP server tool as a `BaseTool` for transparent use in the `ToolRegistry`.
- Tool names are prefixed with `{serverName}__` to prevent naming conflicts.
- Error handling distinguishes connection-level errors (`McpServerUnavailableError`) from application-level errors (`McpToolError`).

### Tracing

The tracing subsystem records all daemon activity in NDJSON format:

**`TraceWriter`**:

- Synchronous `appendFileSync`-based writer for zero-latency trace recording.
- Queue-free design: `emit()` writes directly, silently skips on I/O failure.
- Output: `~/.swifty/traces/daemon.jsonl`.

**`TracingProvider`**:

- Decorator pattern: wraps any `LLMProvider` to record request and response traces.
- Measures latency via `performance.now()`.
- `includePayload` flag controls whether full message content and tool schemas are logged (useful for debugging, expensive for storage).

**Trace directions**:

| Direction      | Color   | Meaning                                     |
| -------------- | ------- | ------------------------------------------- |
| `CLIENT->CORE` | cyan    | Client sent a command to the daemon         |
| `CORE->CLIENT` | yellow  | Daemon sent a response or event to a client |
| `CORE`         | green   | Internal daemon operation                   |
| `CORE->LLM`    | magenta | LLM API request                             |
| `LLM->CORE`    | blue    | LLM API response                            |

**Trace layers**: `ipc` (JSON-RPC commands/responses), `event` (pub/sub events), `llm` (model interactions).

### Event System

The event system provides both in-process and cross-process pub/sub:

**`EventBus`** (in-process):

- Simple publish-subscribe pattern.
- `publish()` awaits handlers sequentially (no concurrent dispatch).
- Used internally by the daemon for component coordination.

**`IpcEventBroadcaster`** (cross-process):

- Manages client event subscriptions with glob-based topic matching (via `picomatch`).
- Scope filtering: `"global"` receives all events, `"run:{runId}"` receives events for a specific run.
- Dead connection cleanup on write failure.
- Backpressure handling: waits for socket drain events before continuing.

**`EventWriter`** (persistence):

- Serializes events to JSONL files for replay and audit.
- Supports `Symbol.asyncDispose` for `using` declarations.

**21 event types** (all use snake_case field names and a `type` discriminator):

`core.started`, `run.started`, `run.finished`, `step.started`, `step.finished`, `tool.call_started`, `tool.call_finished`, `tool.call_failed`, `llm.token`, `llm.usage`, `llm.model_selected`, `log.line`, `session.created`, `session.message_received`, `session.waiting_for_input`, `session.resumed`, `session.closed`, `context.compacted`, `permission.requested`, `permission.granted`, `permission.denied`, `subagent.started`, `subagent.finished`, `skill.invoked`

### Transport Layer

**`SocketServer`**:

- TCP server built on `node:net`.
- NDJSON protocol with `readline`-based line parsing.
- 64 MB maximum frame size (`MAX_LINE_BYTES`).
- `AsyncLocalStorage<net.Socket>` provides per-connection context for event routing.
- Port probing before start to detect an already-running daemon.
- Graceful shutdown: destroys active sockets with a 2-second timeout.

**`SocketClient`**:

- TCP client with JSON-RPC request/response correlation.
- `sendCommand()` returns a promise resolved when the server responds.
- `onEvent()` registers persistent event handlers that survive across reconnections.
- `waitForDisconnect()` resolves when the connection drops (useful for auto-reconnect loops).
- `IpcError` class wraps JSON-RPC error responses with structured error codes.

---

## Terminal UI

The TUI is built with React and Ink, rendering a rich interactive terminal interface:

**Theme**: Warm amber accent (#d4a017) on a deep neutral background (#0a0a0a), with Unicode status indicators for each event type.

**Components**:

| Component            | Purpose                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `App`                | Main orchestrator with auto-reconnect loop (2s retry delay), event accumulation, and slash command dispatch |
| `Header`             | Brand name, connection indicator, session label, error messages                                             |
| `StatusBar`          | Inline display of current step, token counts, elapsed time, context percentage                              |
| `EventLog`           | Scrollable event stream with token merging, keyboard navigation (j/k/arrows, G/g)                           |
| `EventCard`          | Polymorphic renderer for 17+ event types                                                                    |
| `ToolUseCard`        | Inline tool execution indicator with status icons                                                           |
| `InputBar`           | Multi-line text input (Enter to submit, Alt/Shift+Enter for newline)                                        |
| `PermissionPrompt`   | Keyboard-driven 4-choice permission overlay (y/a/n/d or 1/2/3/4)                                            |
| `SlashCompletePopup` | Autocomplete popup for slash commands with filtering                                                        |

**Keyboard shortcuts**:

- `Ctrl+C`: Close session and exit.
- `Ctrl+L`: Clear event log.
- `j` / `k` / arrows: Navigate event log.
- `G` / `g`: Jump to bottom / top of event log.

---

## CLI Reference

```
swifty ping                        # Health check (returns server version and uptime)
swifty run --goal "<description>"  # One-shot agent task
swifty chat                        # Interactive multi-turn chat session
swifty tui                         # Launch the terminal UI
swifty core start                  # Start the daemon (background)
swifty core stop                   # Stop the daemon
swifty core status                 # Check daemon status
swifty trace                       # View trace log
swifty trace --follow              # Tail mode (live updates)
swifty trace --raw                 # Raw NDJSON output
swifty trace --layer llm           # Filter by layer (ipc / event / llm)
swifty trace --direction CORE->LLM # Filter by direction
swifty trace <run_id>              # Filter by run ID
swifty version                     # Print version
```

---

## Configuration

### 5-Tier Priority Chain

Configuration values are resolved in the following order (later tiers override earlier ones):

1. **Built-in defaults** (hardcoded)
2. **Global TOML** (`~/.swifty/config.toml`)
3. **Project-local TOML** (`.swifty/config.toml`)
4. **dotenv** (`.env` file)
5. **Environment variables** (`SWIFTY_*` prefix)

TOML configuration uses strict validation: unknown keys throw errors, and every field is type-checked with descriptive error messages.

### TOML Configuration

```toml
[core]
host = "127.0.0.1"
port = 7437

[logging]
level = "INFO"                      # DEBUG, INFO, WARN, ERROR
file = "~/.swifty/logs/core.log"
format = "text"                     # text, json

[agent]
max_steps = 20

[llm]
default_model = "claude-sonnet-4-6"
router = "static"

[trace]
enabled = true
file = "~/.swifty/traces/daemon.jsonl"
include_llm_payload = true

[permission]
timeout_s = 60.0

[compaction]
auto_threshold = 0.0               # 0.0 = disabled, 0.8 = compact at 80% context
tool_result_limit = 8000            # Max chars per tool result before truncation
tool_result_keep = 4000             # Chars to keep when truncating

[[mcp.servers]]
name = "my-server"
transport = "stdio"                 # stdio, tcp
command = "npx"
args = ["-y", "my-mcp-server"]
```

### Environment Variables

| Variable                           | Default                         | Description                          |
| ---------------------------------- | ------------------------------- | ------------------------------------ |
| `ANTHROPIC_API_KEY`                | (required)                      | Anthropic API key                    |
| `ANTHROPIC_BASE_URL`               | (SDK default)                   | Override API base URL                |
| `SWIFTY_CONFIG`                    | `~/.swifty/config.toml`         | Path to TOML config file             |
| `SWIFTY_HOST`                      | `127.0.0.1`                     | Daemon bind host                     |
| `SWIFTY_PORT`                      | `7437`                          | Daemon bind port                     |
| `SWIFTY_LOG_LEVEL`                 | `INFO`                          | Log level                            |
| `SWIFTY_LOG_FILE`                  | `~/.swifty/logs/core.log`       | Log file path                        |
| `SWIFTY_LOG_FORMAT`                | `text`                          | Log format (text / json)             |
| `SWIFTY_MAX_STEPS`                 | `20`                            | Maximum agent loop steps             |
| `SWIFTY_LLM_DEFAULT_MODEL`         | `claude-sonnet-4-6`             | Default LLM model                    |
| `SWIFTY_TRACE_ENABLED`             | `true`                          | Enable/disable tracing               |
| `SWIFTY_TRACE_FILE`                | `~/.swifty/traces/daemon.jsonl` | Trace file path                      |
| `SWIFTY_TRACE_INCLUDE_LLM_PAYLOAD` | `true`                          | Include full LLM payloads in traces  |
| `SWIFTY_PERMISSION_TIMEOUT_S`      | `60`                            | Permission prompt timeout (seconds)  |
| `SWIFTY_COMPACT_THRESHOLD`         | `0.0`                           | Auto-compaction threshold (0.0-1.0)  |
| `SWIFTY_COMPACT_TOOL_LIMIT`        | `8000`                          | Tool result truncation limit (chars) |
| `SWIFTY_COMPACT_TOOL_KEEP`         | `4000`                          | Tool result keep size (chars)        |

---

## JSON-RPC Protocol

All client-daemon communication uses JSON-RPC 2.0 over TCP with newline-delimited JSON (NDJSON) framing.

### Commands

| Method                 | Parameters                | Description                                                                                 |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `core.ping`            | --                        | Health check. Returns `server_version`, `uptime_ms`, `received_at`.                         |
| `agent.run`            | `goal`, `max_steps?`      | One-shot agent task. Returns `run_id`.                                                      |
| `event.subscribe`      | `topics[]`, `scope?`      | Subscribe to event topics with glob patterns. Returns `subscription_id`.                    |
| `session.create`       | `mode`, `title?`          | Create a session (`one_shot` or `chat`). Returns session metadata.                          |
| `session.send_message` | `session_id`, `message`   | Send a message to a session. Returns `run_id`.                                              |
| `session.get_history`  | `session_id`              | Retrieve message history.                                                                   |
| `session.close`        | `session_id`              | Close a session.                                                                            |
| `session.compact`      | `session_id`, `focus?`    | Manually compact session thread.                                                            |
| `permission.respond`   | `tool_use_id`, `decision` | Respond to a permission request (`allow_once`, `deny_once`, `always_allow`, `always_deny`). |

### Events

All events use snake_case field names and a `type` discriminator. All events include a `timestamp` field (ISO 8601). Clients subscribe via `event.subscribe` with glob patterns (e.g., `["*"]` for all, `["llm.*"]` for LLM events only).

| Event Type                  | Key Fields                                                                                                             | Emitted When                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `core.started`              | `listen_addr`, `version`                                                                                               | Daemon starts listening        |
| `run.started`               | `run_id`, `goal`                                                                                                       | Agent run begins               |
| `run.finished`              | `run_id`, `status`, `reason`, `steps`                                                                                  | Agent run ends                 |
| `step.started`              | `run_id`, `step`                                                                                                       | LLM call begins for a step     |
| `step.finished`             | `run_id`, `step`                                                                                                       | Step completes (LLM + tools)   |
| `tool.call_started`         | `run_id`, `tool_use_id`, `tool_name`, `params`                                                                         | Tool invocation begins         |
| `tool.call_finished`        | `run_id`, `tool_use_id`, `tool_name`, `elapsed_ms`, `output`                                                           | Tool invocation succeeds       |
| `tool.call_failed`          | `run_id`, `tool_use_id`, `tool_name`, `error_class`, `error_message`, `elapsed_ms`, `attempt`                          | Tool invocation fails          |
| `llm.token`                 | `run_id`, `token`                                                                                                      | Streaming text delta           |
| `llm.usage`                 | `run_id`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `context_percent` | Token usage report             |
| `llm.model_selected`        | `run_id`, `model`, `strategy`                                                                                          | Model chosen for request       |
| `session.created`           | `session_id`, `mode`                                                                                                   | New session created            |
| `session.message_received`  | `session_id`, `content`                                                                                                | User message accepted          |
| `session.waiting_for_input` | `session_id`, `last_run_id`                                                                                            | Agent finished, awaiting input |
| `session.resumed`           | `session_id`                                                                                                           | Chat session resumed           |
| `session.closed`            | `session_id`                                                                                                           | Session closed                 |
| `context.compacted`         | `session_id`, `run_id`, `original_tokens`, `summary_tokens`                                                            | Context compaction completed   |
| `permission.requested`      | `run_id`, `tool_use_id`, `tool_name`, `params`, `param_preview`, `session_id`                                          | Permission prompt needed       |
| `permission.granted`        | `run_id`, `tool_use_id`, `decision`                                                                                    | Permission allowed             |
| `permission.denied`         | `run_id`, `tool_use_id`, `decision`                                                                                    | Permission denied              |
| `subagent.started`          | `run_id`, `parent_run_id`, `description`                                                                               | Sub-agent spawned              |
| `subagent.finished`         | `run_id`, `parent_run_id`, `status`                                                                                    | Sub-agent completed            |
| `skill.invoked`             | `skill_name`, `arguments`, `run_id`                                                                                    | Skill activated                |
| `log.line`                  | `run_id`, `level`, `source`, `message`                                                                                 | Log output                     |

---

## Project Structure

```
swifty-code/
├── src/
│   ├── index.ts                         # Version export
│   ├── dev.ts                           # Dev launcher (daemon + TUI)
│   ├── cli/
│   │   ├── main.ts                      # CLI entry point with subcommand dispatch
│   │   └── commands/
│   │       ├── chat.ts                  # Multi-turn interactive chat
│   │       ├── core.ts                  # Daemon lifecycle (start/stop/status)
│   │       ├── run.ts                   # One-shot agent task runner
│   │       ├── trace.ts                 # Trace log viewer
│   │       └── version.ts              # Version display
│   ├── core/
│   │   ├── app.ts                       # Daemon entry: TCP server + handler registration
│   │   ├── config.ts                    # 4-tier config: defaults -> TOML -> .env -> env vars
│   │   ├── context.ts                   # ExecutionContext: messages, step counter, status
│   │   ├── loop.ts                      # AgentLoop: plan-act-observe driver
│   │   ├── runner.ts                    # AgentRunner: dependency assembly + run execution
│   │   ├── runs.ts                      # Run ID generation and directory management
│   │   ├── logging.ts                   # Pino logger setup
│   │   ├── agents/
│   │   │   ├── loader.ts               # 3-tier agent profile loader
│   │   │   └── builtin/                # planner.toml, executor.toml, reviewer.toml
│   │   ├── bus/
│   │   │   ├── commands.ts             # Zod schemas for all JSON-RPC commands/results
│   │   │   ├── events.ts               # Zod schemas for all event types
│   │   │   ├── envelope.ts             # JSON-RPC 2.0 envelope types + HandlerError
│   │   │   └── index.ts                # Barrel export
│   │   ├── compact/
│   │   │   ├── budget.ts               # Tool result truncation
│   │   │   └── compactor.ts            # LLM-driven context compression
│   │   ├── events/
│   │   │   ├── bus.ts                   # EventBus pub/sub
│   │   │   └── writer.ts               # NDJSON event writer
│   │   ├── llm/
│   │   │   ├── base.ts                  # LLMProvider interface
│   │   │   ├── provider.ts             # AnthropicProvider with streaming + retry
│   │   │   └── types.ts                # LlmResponse, UsageStats, ToolCallBlock
│   │   ├── mcp/
│   │   │   ├── client.ts               # MCP JSON-RPC client (stdio + tcp)
│   │   │   ├── server.ts               # MCP server lifecycle manager
│   │   │   └── tool.ts                 # MCP tool wrapper
│   │   ├── memory/
│   │   │   └── loader.ts               # Context file loader (~/.swifty/context.md)
│   │   ├── permissions/
│   │   │   ├── errors.ts               # PermissionDeniedError
│   │   │   ├── manager.ts              # 6-tier permission evaluation
│   │   │   ├── policy.ts               # Default policies + OUTSIDE_CWD heuristics
│   │   │   └── storage.ts              # policy.toml persistence
│   │   ├── session/
│   │   │   ├── manager.ts              # Session lifecycle + PromiseMutex
│   │   │   ├── model.ts                # Session data model + serialization
│   │   │   └── store.ts                # File-based session persistence
│   │   ├── skills/
│   │   │   ├── loader.ts               # 3-tier skill loader with YAML frontmatter
│   │   │   └── builtin/                # init.md, orchestrate.md, review.md, summarize.md
│   │   ├── subagent/
│   │   │   ├── registry.ts             # Background task registry
│   │   │   └── tool.ts                 # SpawnAgentTool + AgentResultTool
│   │   ├── task/
│   │   │   ├── manager.ts              # File-based task CRUD with dependencies
│   │   │   └── model.ts                # Task data model + status enum
│   │   ├── tools/
│   │   │   ├── base.ts                  # BaseTool interface + ToolResult
│   │   │   ├── errors.ts               # RateLimitedError
│   │   │   ├── invocation.ts           # Tool invocation pipeline
│   │   │   ├── registry.ts             # ToolRegistry with Anthropic schema export
│   │   │   └── builtin/                # 9 built-in tools
│   │   ├── trace/
│   │   │   ├── provider.ts             # TracingProvider decorator
│   │   │   ├── record.ts               # TraceRecord schema (snake_case)
│   │   │   └── writer.ts               # Synchronous NDJSON trace writer
│   │   └── transport/
│   │       ├── ipc-broadcaster.ts      # Topic-based event broadcasting
│   │       ├── socket-client.ts        # TCP JSON-RPC client
│   │       └── socket-server.ts        # TCP JSON-RPC server
│   └── tui/
│       ├── index.ts                     # TUI entry point
│       ├── run-tui.ts                   # TUI launcher
│       ├── app.tsx                      # Main TUI application (Ink + React)
│       ├── theme.ts                     # Color palette and Unicode indicators
│       └── components/                  # React components for terminal rendering
├── tests/
│   ├── integration/                     # End-to-end TCP tests
│   └── unit/                            # Unit tests for all core modules
├── package.json
├── tsconfig.json
├── tsup.config.ts                       # Build configuration (ESM, Node 24)
├── vitest.config.ts                     # Test configuration (V8 coverage)
├── eslint.config.js                     # Strict type-checked ESLint
└── README.md
```

---

## Prerequisites

- Node.js >= 20
- pnpm >= 10
- `ANTHROPIC_API_KEY` environment variable

## Getting Started

```bash
# Install dependencies
pnpm install

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start daemon + TUI (development mode)
pnpm dev

# Or start them separately:
pnpm dev:core    # Daemon only (background)
pnpm dev:tui     # TUI only (requires daemon running)
```

---

## Development

```bash
# Type check
pnpm typecheck

# Lint (with auto-fix)
pnpm lint

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run all quality checks (typecheck + lint + test + format)
pnpm qa

# Format code
pnpm format

# Generate protocol documentation
pnpm doc

# Build for production
pnpm build
```

### Test Coverage

- **46 test files** covering all core modules
- Unit tests: bus, compact, config, context, events, llm, memory, permissions, session, skills, subagent, task, tools, trace, transport
- Integration tests: end-to-end TCP JSON-RPC roundtrip, full daemon lifecycle
- Coverage provider: V8 with 50% threshold for branches, functions, lines, and statements
- Hand-rolled test stubs (no mocking libraries)

### Coding Standards

- **Strict TypeScript**: `strict`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`
- **Zero type assertions**: The ESLint rule `@typescript-eslint/consistent-type-assertions` is set to `assertionStyle: "never"`. All type narrowing uses runtime type guards or Zod validation.
- **Zero eslint-disable comments**: No suppression directives anywhere in the codebase.
- **Zod v4 schemas**: All wire protocol types (commands, events, tool parameters) are defined with Zod schemas and validated at runtime boundaries.
- **snake_case wire format**: All JSON-RPC fields use snake_case, enforced by Zod schemas.
- **kebab-case filenames**, camelCase code identifiers.
- **ESM-only**: `"type": "module"` with NodeNext module resolution.
- **Target**: ES2024, Node.js 24.

---

## Data Directories

| Path                                     | Purpose                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `~/.swifty/config.toml`                  | Global configuration                                                  |
| `~/.swifty/policy.toml`                  | Persistent permission policies (always-allow / always-deny)           |
| `~/.swifty/sessions/`                    | Session data: `meta.json`, `thread.jsonl`, `notes.md`, `summary_*.md` |
| `~/.swifty/sessions/{sid}/runs/{runId}/` | Per-run event logs (`events.jsonl`)                                   |
| `~/.swifty/traces/daemon.jsonl`          | Trace log (NDJSON)                                                    |
| `~/.swifty/logs/core.log`                | Application log (Pino)                                                |
| `~/.swifty/context.md`                   | Global context injected into agent system prompts                     |
| `~/.swifty/agents/`                      | User-global agent profiles (TOML)                                     |
| `~/.swifty/skills/`                      | User-global skill definitions (Markdown + YAML)                       |
| `~/.swifty/swifty-core.pid`              | Daemon PID file                                                       |
| `.swifty/config.toml`                    | Project-local configuration                                           |
| `.swifty/context.md`                     | Project-local context                                                 |
| `.swifty/agents/`                        | Project-local agent profiles                                          |
| `.swifty/skills/`                        | Project-local skill definitions                                       |
| `.tasks/`                                | Per-run task persistence (`task_{id}.json`)                           |

---

## License

MIT
