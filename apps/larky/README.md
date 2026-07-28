# larky

Dual-process CLI coding agent — the full larky agent stack hosted behind a persistent daemon.

## Overview

larky runs the complete larky coding agent (streaming agent loop, 17+ tools, permissions, hooks, sandbox, skills, teams, memory, MCP, file history, plan mode) inside a long-lived daemon process (`larky-core`), with a thin Ink/React TUI client that talks to it over a TCP JSON-RPC protocol.

The two processes:

- **daemon (`dist/core/app.js`)** — owns all agent state: LLM clients, conversations, tool registry, permission checker, hooks, skills, teams, memory, file history, and session persistence (`.larky/` directories, fully compatible with larky).
- **client (`dist/cli/main.js`)** — mode dispatch + rendering. The default TUI connects over TCP, subscribes to the event stream, and answers interaction requests (permission / ask-user / plan approval) via RPCs. Print mode (`-p`), teammate mode (`--teammate`), and remote mode (`--remote`) run the agent in-process without the daemon.

## Features

- Streaming agent loop with thinking, retry/backoff, auto-compaction, and max-token recovery
- Tools: ReadFile, Write, Edit, Bash (sandboxable), Glob, Grep (WASM-accelerated), AskUserQuestion, ToolSearch (deferred tools), Enter/ExitWorktree, ExitPlanMode, Task tools, LoadSkill/InstallSkill, team tools, MCP tools
- Permission modes: default / acceptEdits / plan / bypassPermissions, cycled with shift+tab; interactive approval dialogs over the wire
- Plan mode with daemon-driven plan-approval flow (yolo / manual / feedback)
- Skills (`.larky/skills/`), user slash commands (`.larky/commands/*.md`), inline and fork execution
- Teams multi-agent collaboration (in-process teammates by default; tmux/iTerm backends spawn `larky --teammate`)
- Long-term memory: extraction, consolidation, recall; `/memory` command
- File history checkpoints with `/rewind` (restore code and/or conversation)
- Session persistence in `.larky/sessions/*.jsonl`, `/resume`, compact boundaries
- Sandbox (macOS seatbelt / Linux bwrap) via `/sandbox`
- Event replay: per-run `events.jsonl` + `replay_from_run` reconnect recovery

## Architecture

```
 +---------------------+     TCP JSON-RPC / NDJSON     +---------------------------+
 |  CLI client          |  <=========================> |  larky-core daemon        |
 |  TUI (Ink/React)     |      127.0.0.1:5520          |  AgentSession per client  |
 |  - render events     |                              |  - larky Agent loop      |
 |  - dialogs -> RPCs   |   events: agent.*, run.*,    |  - tools/permissions/...  |
 |  - local: history,   |   permission.requested, ...  |  - session persistence    |
 |    @-expand, scroll  |   RPCs: session.*, run.*,    |  - events.jsonl replay    |
 +---------------------+    permission.respond, ...    +---------------------------+
```

Interaction requests use the pending-map pattern: the daemon emits an event carrying an `id` (`permission.requested`, `ask_user.requested`, `plan.requested`) and blocks the agent until a client answers via the matching `*.respond` RPC. If the last subscribed client disconnects, all pending requests are denied so the agent never freezes.

See [PROTOCOL.md](./PROTOCOL.md) (generated from zod schemas — `pnpm doc`).

## Usage

```bash
larky                        # TUI (auto-starts the daemon)
larky -p "fix the tests"     # print mode (non-interactive, in-process)
larky --remote :18888        # browser UI (Koa + WebSocket, in-process)
larky ping                   # daemon health check
larky core start|stop|status # daemon lifecycle
larky trace --layer ipc -f   # follow the wire trace
```

Configuration lives in larky's `.larky/config.yaml` (providers, hooks, MCP, sandbox) plus larky's `~/.larky/config.toml` / `LARKY_*` env vars (host/port/logging/trace).

## Development

```bash
pnpm dev        # spawn daemon (tsx) + TUI in one terminal
pnpm core       # daemon only
pnpm cli        # client only
pnpm test       # vitest (unit + dual-process integration)
pnpm typecheck
pnpm build      # tsup dual-entry bundle (dist/cli/main.js + dist/core/app.js)
pnpm doc        # regenerate PROTOCOL.md
```

## License

MIT
