# larky

Dual-process CLI coding agent powered by Claude.

## Overview

larky is an AI-powered coding agent that runs as a persistent background daemon with multiple front-end interfaces. It uses a plan-act-observe loop driven by Claude (Anthropic) to accomplish user goals through file manipulation, shell commands, and extensible tool integrations.

The architecture separates concerns into two processes: a long-lived daemon (larky-core) that manages agent runs, sessions, permissions, and LLM connections, and lightweight client processes (CLI or TUI) that communicate with the daemon over a TCP JSON-RPC protocol.

## Features

### Agent Capabilities

- Plan-act-observe loop with configurable step limits (default 20 steps)
- Built-in tools for file I/O, shell execution, directory listing, note-taking, and task management
- Subagent spawning for parallel background work (spawn_agent / agent_result)
- MCP (Model Context Protocol) server integration for third-party tool extensions
- Agent profiles (planner, executor, reviewer) defined in TOML
- Skills system with built-in skills (init, orchestrate, review, summarize)
- Context memory layers: global (~/.larky/context.md), project (.larky/context.md), and session notes

### Session Management

- Two session modes: one_shot (single-goal, auto-closing) and chat (multi-turn interactive)
- Per-run event logs stored in ~/.larky/sessions/{sid}/runs/{runId}/events.jsonl
- Context compaction (manual /compact or automatic via threshold) for long-running sessions
- Session notes persistence via note_save tool

### Permission System

- Interactive permission prompts for tool invocations
- Persistent policy file (~/.larky/policy.toml) with four decision types: allow_once, always_allow, deny_once, always_deny
- Configurable timeout (default 60 seconds)

### Interfaces

- CLI with subcommands: ping, run, chat, tui, trace, core start/stop/status, version
- Terminal UI (TUI) built with Ink and React for interactive sessions
- JSON-RPC 2.0 TCP protocol for programmatic integration

### Observability

- NDJSON trace log (~/.larky/traces/daemon.jsonl) with directional coloring
- Trace filtering by layer (ipc, event, llm), direction, and run ID
- Pino-based structured logging with configurable levels

## Architecture

```
 +-----------+       TCP JSON-RPC       +------------------+
 | CLI / TUI |  <====================>  |   larky-core     |
 |  (client) |     127.0.0.1:5520       |   (daemon)       |
 +-----------+                           +-----------------+
                                              |
                                    +---------+---------+
                                    |                   |
                              +-----------+      +------------+
                              | Anthropic |      | MCP Servers|
                              |   LLM     |      |  (optional)|
                              +-----------+      +------------+
```

The client spawns a SocketClient that connects to the daemon's SocketServer. Commands flow as JSON-RPC 2.0 requests, while events are pushed via an EventBus through an IpcEventBroadcaster to subscribed clients over the same TCP connection.

Agent runs are orchestrated by AgentRunner, which assembles the LLM provider (AnthropicProvider), tool registry, permission manager, MCP tools, and event bus. The AgentLoop drives the plan-act-observe cycle, calling the LLM at each step and invoking tools based on the model's response.

## Installation

```bash
# From the monorepo root
pnpm install

# Build the CLI binary
pnpm --filter @swifty.js/larky build
```

The bin entry (larky) points to dist/cli/main.js after building.

## Configuration

Configuration follows a 5-tier priority chain where later tiers override earlier ones:

1. Built-in defaults (hardcoded)
2. Global TOML config (~/.larky/config.toml)
3. Project-local TOML (.larky/config.toml)
4. dotenv (.env file in current directory)
5. Environment variables (LARKY\_ prefix)

### Key Environment Variables

| Variable                   | Default                      | Description                                |
| -------------------------- | ---------------------------- | ------------------------------------------ |
| ANTHROPIC_API_KEY          | (required)                   | Anthropic API key                          |
| ANTHROPIC_BASE_URL         | (SDK default)                | Override API base URL                      |
| LARKY_HOST                 | 127.0.0.1                    | Daemon bind host                           |
| LARKY_PORT                 | 5520                         | Daemon bind port                           |
| LARKY_LOG_LEVEL            | INFO                         | Log level (DEBUG / INFO / WARN / ERROR)    |
| LARKY_LOG_FILE             | ~/.larky/logs/core.log       | Log file path                              |
| LARKY_MAX_STEPS            | 20                           | Maximum agent loop steps                   |
| LARKY_LLM_DEFAULT_MODEL    | claude-sonnet-4-6            | Default LLM model                          |
| LARKY_TRACE_ENABLED        | true                         | Enable/disable tracing                     |
| LARKY_TRACE_FILE           | ~/.larky/traces/daemon.jsonl | Trace file path                            |
| LARKY_PERMISSION_TIMEOUT_S | 60                           | Permission prompt timeout (seconds)        |
| LARKY_COMPACT_THRESHOLD    | 0.0                          | Auto-compaction threshold (0.0 = disabled) |
| LARKY_CONFIG               | ~/.larky/config.toml         | Path to TOML config file                   |

### MCP Server Configuration

MCP servers are configured in the TOML config file:

```toml
[[mcp.servers]]
name = "my-server"
transport = "stdio"
command = "npx"
args = ["-y", "@my/mcp-server"]
env = { API_KEY = "..." }
```

## Usage

### Start the daemon

```bash
larky core start
```

### One-shot task

```bash
larky run "Summarize the project README"
```

### Interactive chat

```bash
larky chat
```

### Terminal UI

```bash
larky tui
```

### Check daemon status

```bash
larky core status
larky ping
```

### View traces

```bash
larky trace                          # All trace records
larky trace --follow                 # Tail mode
larky trace --layer llm              # Filter by layer
larky trace --direction "CORE->LLM"  # Filter by direction
larky trace run-abc123               # Filter by run ID
```

### Stop the daemon

```bash
larky core stop
```

### Force-kill all processes

```bash
node kill.mjs
```

## Built-in Tools

| Tool         | Description                    |
| ------------ | ------------------------------ |
| read_file    | Read file contents from disk   |
| write_file   | Write content to a file        |
| bash         | Execute shell commands         |
| list_dir     | List directory entries         |
| note_save    | Persist session notes to disk  |
| task_create  | Create a tracked task          |
| task_update  | Update a task's status         |
| task_list    | List all tracked tasks         |
| task_get     | Get details of a specific task |
| spawn_agent  | Spawn a background subagent    |
| agent_result | Retrieve a subagent's result   |

## Wire Protocol

The daemon communicates with clients over TCP loopback using NDJSON (newline-delimited JSON). Commands follow JSON-RPC 2.0 format, while events use a kind=event envelope pushed from server to client. See WIRE_PROTOCOL.md for the full specification of all commands, events, and error codes.
