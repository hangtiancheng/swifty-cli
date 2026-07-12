# swifty-code

Dual-process CLI coding agent powered by Claude.

## Overview

swifty-code is an AI-powered coding agent that runs as a persistent background daemon with multiple front-end interfaces. It uses a plan-act-observe loop driven by Claude (Anthropic) to accomplish user goals through file manipulation, shell commands, and extensible tool integrations.

The architecture separates concerns into two processes: a long-lived daemon (swifty-core) that manages agent runs, sessions, permissions, and LLM connections, and lightweight client processes (CLI or TUI) that communicate with the daemon over a TCP JSON-RPC protocol.

## Features

### Agent Capabilities

- Plan-act-observe loop with configurable step limits (default 20 steps)
- Built-in tools for file I/O, shell execution, directory listing, note-taking, and task management
- Subagent spawning for parallel background work (spawn_agent / agent_result)
- MCP (Model Context Protocol) server integration for third-party tool extensions
- Agent profiles (planner, executor, reviewer) defined in TOML
- Skills system with built-in skills (init, orchestrate, review, summarize)
- Context memory layers: global (~/.swifty/context.md), project (.swifty/context.md), and session notes

### Session Management

- Two session modes: one_shot (single-goal, auto-closing) and chat (multi-turn interactive)
- Per-run event logs stored in ~/.swifty/sessions/{sid}/runs/{runId}/events.jsonl
- Context compaction (manual /compact or automatic via threshold) for long-running sessions
- Session notes persistence via note_save tool

### Permission System

- Interactive permission prompts for tool invocations
- Persistent policy file (~/.swifty/policy.toml) with four decision types: allow_once, always_allow, deny_once, always_deny
- Configurable timeout (default 60 seconds)

### Interfaces

- CLI with subcommands: ping, run, chat, tui, trace, core start/stop/status, version
- Terminal UI (TUI) built with Ink and React for interactive sessions
- JSON-RPC 2.0 TCP protocol for programmatic integration

### Observability

- NDJSON trace log (~/.swifty/traces/daemon.jsonl) with directional coloring
- Trace filtering by layer (ipc, event, llm), direction, and run ID
- Pino-based structured logging with configurable levels

## Architecture

```
 +-----------+       TCP JSON-RPC       +------------------+
 | CLI / TUI |  <====================>  |   swifty-core     |
 |  (client) |     127.0.0.1:7437       |   (daemon)         |
 +-----------+                           +------------------+
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
pnpm --filter @swifty.js/swifty-code build
```

The bin entry (swifty-code) points to dist/cli/main.js after building.

## Configuration

Configuration follows a 5-tier priority chain where later tiers override earlier ones:

1. Built-in defaults (hardcoded)
2. Global TOML config (~/.swifty/config.toml)
3. Project-local TOML (.swifty/config.toml)
4. dotenv (.env file in current directory)
5. Environment variables (SWIFTY\_ prefix)

### Key Environment Variables

| Variable                    | Default                       | Description                                |
| --------------------------- | ----------------------------- | ------------------------------------------ |
| ANTHROPIC_API_KEY           | (required)                    | Anthropic API key                          |
| ANTHROPIC_BASE_URL          | (SDK default)                 | Override API base URL                      |
| SWIFTY_HOST                 | 127.0.0.1                     | Daemon bind host                           |
| SWIFTY_PORT                 | 7437                          | Daemon bind port                           |
| SWIFTY_LOG_LEVEL            | INFO                          | Log level (DEBUG / INFO / WARN / ERROR)    |
| SWIFTY_LOG_FILE             | ~/.swifty/logs/core.log       | Log file path                              |
| SWIFTY_MAX_STEPS            | 20                            | Maximum agent loop steps                   |
| SWIFTY_LLM_DEFAULT_MODEL    | claude-sonnet-4-6             | Default LLM model                          |
| SWIFTY_TRACE_ENABLED        | true                          | Enable/disable tracing                     |
| SWIFTY_TRACE_FILE           | ~/.swifty/traces/daemon.jsonl | Trace file path                            |
| SWIFTY_PERMISSION_TIMEOUT_S | 60                            | Permission prompt timeout (seconds)        |
| SWIFTY_COMPACT_THRESHOLD    | 0.0                           | Auto-compaction threshold (0.0 = disabled) |
| SWIFTY_CONFIG               | ~/.swifty/config.toml         | Path to TOML config file                   |

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
swifty-code core start
```

### One-shot task

```bash
swifty-code run "Summarize the project README"
```

### Interactive chat

```bash
swifty-code chat
```

### Terminal UI

```bash
swifty-code tui
```

### Check daemon status

```bash
swifty-code core status
swifty-code ping
```

### View traces

```bash
swifty-code trace                          # All trace records
swifty-code trace --follow                 # Tail mode
swifty-code trace --layer llm              # Filter by layer
swifty-code trace --direction "CORE->LLM"  # Filter by direction
swifty-code trace run-abc123               # Filter by run ID
```

### Stop the daemon

```bash
swifty-code core stop
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

## Development

```bash
pnpm dev                  # Run dev entry (src/dev.ts)
pnpm dev:core             # Run daemon in foreground (src/core/app.ts)
pnpm dev:tui              # Run TUI in dev mode (src/tui/bootstrap.ts)
pnpm build                # Build production bundles with tsup
pnpm typecheck            # Type-check without emitting (tsc --noEmit)
pnpm lint                 # Lint source files with ESLint
pnpm lint:fix             # Lint and auto-fix issues
pnpm format               # Format code with oxfmt
pnpm test                 # Run tests with Vitest
pnpm test:watch           # Run tests in watch mode
pnpm test:coverage        # Run tests with coverage report
pnpm doc                  # Regenerate WIRE_PROTOCOL.md from source schemas
```

### Project Structure

```
apps/swifty-code/
  src/
    cli/
      main.ts                 CLI entry point and subcommand dispatcher
      commands/               CLI command implementations (core, run, chat, trace, version)
    core/
      app.ts                  Daemon entry: TCP server, handler registration, shutdown
      config.ts               5-tier config loader (defaults, TOML, dotenv, env vars)
      loop.ts                 AgentLoop: plan-act-observe driver
      runner.ts               AgentRunner: assembles dependencies, executes runs
      context.ts              ExecutionContext: per-run state container
      agents/                 Agent profile loader and built-in TOML profiles
      bus/                    Command and event schema definitions (Zod)
      compact/                Context compaction (budget + compactor)
      events/                 EventBus and event writer
      llm/                    Anthropic LLM provider and types
      mcp/                    MCP server manager and tool adapter
      memory/                 Context file loader (context.md)
      permissions/            Permission manager, policy, and storage
      session/                Session manager, model, and store
      skills/                 Skill loader and built-in skill files
      subagent/               Subagent registry and spawn/result tools
      task/                   Task manager for tracked tasks
      tools/                  Tool base class, registry, invocation, and built-in tools
      trace/                  Trace writer, provider, and record types
      transport/              TCP socket server, client, and IPC broadcaster
    tui/
      bootstrap.ts            TUI bootstrap (sync output + launch)
      index.ts                Ink render entry
      app.tsx                 Main TUI React component
      chat.tsx                Chat view component
      permission-dialog.tsx   Permission prompt dialog
      tool-display.tsx        Tool invocation display
    dev.ts                    Development entry point
    version.ts                Runtime version resolver from package.json
  tests/                      46 test files covering all major subsystems
  scripts/
    gen-protocol-doc.ts       Generates WIRE_PROTOCOL.md from Zod schemas
  kill.mjs                    Force-kill all swifty-code processes
  tsup.config.ts             Build config (CLI bundle + core bundle)
  vitest.config.ts           Test config with coverage thresholds
  eslint.config.js           ESLint flat config with strict TypeScript rules
```

## Data Directories

| Path                                   | Purpose                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| ~/.swifty/config.toml                  | Global configuration                                            |
| ~/.swifty/policy.toml                  | Persistent permission policies                                  |
| ~/.swifty/context.md                   | Global context injected into agent system prompts               |
| ~/.swifty/sessions/                    | Session data: meta.json, thread.jsonl, notes.md, summary\_\*.md |
| ~/.swifty/sessions/{sid}/runs/{runId}/ | Per-run event logs                                              |
| ~/.swifty/traces/daemon.jsonl          | Trace log (NDJSON)                                              |
| ~/.swifty/logs/core.log                | Application log (Pino)                                          |
| ~/.swifty/swifty-core.pid              | Daemon PID file                                                 |
| ~/.swifty/agents/{name}.toml           | User-defined agent profiles                                     |
| .swifty/config.toml                    | Project-local configuration                                     |
| .swifty/context.md                     | Project-local context                                           |
| .swifty/agents/{name}.toml             | Project-local agent profiles                                    |

## Tech Stack

| Layer           | Technology                                           |
| --------------- | ---------------------------------------------------- |
| Runtime         | Node.js (ESM, target ES2024, node20)                 |
| Language        | TypeScript 5.9 with strict mode                      |
| LLM             | Anthropic Claude SDK (@anthropic-ai/sdk)             |
| TUI             | Ink 7 + React 19                                     |
| Build           | tsup 8                                               |
| Bundled deps    | All dependencies bundled (noExternal)                |
| Testing         | Vitest 4 with v8 coverage                            |
| Linting         | ESLint 9 (flat config) + typescript-eslint + unicorn |
| Formatting      | oxfmt                                                |
| Logging         | Pino 10 + pino-roll                                  |
| Validation      | Zod 4                                                |
| Config          | TOML + dotenv                                        |
| Fuzzy search    | fuse.js                                              |
| IPC             | TCP loopback with NDJSON JSON-RPC 2.0                |
| Package manager | pnpm 10 (monorepo)                                   |

## Publishing

```bash
pnpm publish:latest       # Publish as latest
pnpm publish:alpha        # Publish with alpha tag
pnpm publish:beta         # Publish with beta tag
pnpm publish:rc           # Publish with rc tag
pnpm publish:canary       # Publish with canary tag
pnpm publish:nightly      # Publish with nightly tag
pnpm publish:dev          # Publish with dev tag
```

## License

ISC
