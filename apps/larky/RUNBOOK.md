# larky RUNBOOK

Operational notes for the dual-process larky agent.

## Processes

| Process             | Entry              | Role                                                            |
| ------------------- | ------------------ | --------------------------------------------------------------- |
| daemon `larky-core` | `dist/core/app.js` | Full larky agent stack, TCP JSON-RPC server on `127.0.0.1:5520` |
| client `larky`      | `dist/cli/main.js` | TUI / print / teammate / remote modes                           |

## Lifecycle

- `larky` (no args) pings the daemon; if unreachable it spawns `node dist/core/app.js` detached, writes the PID to `~/.larky/larky-core.pid`, and waits for ping (250ms × 20). A daemon started this way is stopped when the TUI exits; a manually started daemon is left running.
- `larky core start|stop|status` manages the daemon explicitly. `stop` verifies the PID's command line via `ps` before killing (PID-reuse guard, B-12).
- Emergency: `node kill.mjs` kills all larky processes.

## Configuration

- larky config (providers, hooks, MCP, sandbox, permission_mode): `~/.larky/config.yaml` → project `.larky/config.yaml` → `.larky/config.local.yml`.
- larky infra config (host/port/logging/trace): `~/.larky/config.toml`, project `.larky/config.toml`, `.env`, `LARKY_*` env vars (`LARKY_HOST`, `LARKY_PORT`, `LARKY_LOG_LEVEL`, `LARKY_LOG_FILE`, `LARKY_TRACE_*`).

## State on disk

| Path                                                | Contents                                    |
| --------------------------------------------------- | ------------------------------------------- |
| `<workdir>/.larky/sessions/*.jsonl`                 | conversation persistence (larky-compatible) |
| `<workdir>/.larky/file-history/`                    | rewind checkpoints                          |
| `<workdir>/.larky/daemon/runs/<runId>/events.jsonl` | wire events for `replay_from_run`           |
| `<workdir>/.larky/skills/`, `.larky/commands/`      | skills and user slash commands              |
| `~/.larky/larky-core.pid`                           | daemon PID file                             |
| `~/.larky/logs/core.log`                            | daemon log (10MB × 5 rotation)              |
| `~/.larky/traces/daemon.jsonl`                      | NDJSON wire trace (`larky trace`)           |

## Debugging

- `larky trace --layer ipc --follow` — live wire traffic (commands, responses, pushes).
- `larky ping` / `larky core status` — health.
- Daemon stderr goes to the log file; in dev (`pnpm dev`) stderr is inherited by the terminal.
- Reconnect recovery: the TUI resubscribes with `replay_from_run=<last run id>`; replayed lines come from the run's `events.jsonl`.

## Known behaviors

- If the last subscribed client disconnects, the daemon cancels all pending permission/ask-user/plan requests as "deny" so agent runs never hang (B-3).
- Slow clients get a per-socket serial write queue; a dead socket is dropped without blocking others (B-10).
- `event.subscribe` snapshots replay lines synchronously before subscribing, so no events are lost in the gap (B-11).
- Sending a new message while a run is streaming interrupts the current run first (steering).
