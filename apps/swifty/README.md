# Swifty

Swifty is a terminal-based AI coding agent. It provides an interactive TUI (terminal user interface) for conversing with large language models, executing code, manipulating files, and orchestrating multi-agent workflows, all from the command line.

## Overview

Swifty runs as a single CLI binary that connects to configurable LLM providers (Anthropic, OpenAI, or any OpenAI-compatible endpoint). It renders a rich terminal interface using React and Ink, giving you streaming responses, tool execution feedback, permission prompts, and slash commands in a single pane.

Beyond interactive use, Swifty supports a non-interactive print mode for scripting, a remote mode that serves a browser-based chat UI over WebSocket, and a teammate mode that lets one lead agent coordinate multiple subagents working in parallel.

## Features

### Core Capabilities

- Multi-provider LLM support with Anthropic, OpenAI, and OpenAI-compatible protocols
- Interactive terminal UI with streaming text, thinking indicators, and tool execution display
- Built-in tool set: ReadFile, WriteFile, EditFile, Bash, Glob, Grep, ToolSearch, EnterWorktree, ExitWorktree, ExitPlanMode
- MCP (Model Context Protocol) server integration for extending the tool set with external services
- Permission system with four modes: default, acceptEdits, plan (read-only), and bypassPermissions
- Sandbox support via bwrap (Linux) and seatbelt (macOS) for isolated command execution
- Dangerous command pattern detection with human-in-the-loop approval dialogs

### Conversation and Memory

- Session persistence with JSONL-based storage for cross-session resume
- Automatic context compaction when conversations approach the model's context window
- Long-term memory extraction and recall across sessions
- Instructions file support for persistent project-level guidance

### Skills and Commands

- Skill catalog with three-tier loading: built-in, user-global (~/.swifty/skills/), and project-level (.swifty/skills/)
- Hot-reload support for skills edited on disk
- Inline and fork execution modes for skills
- Slash command system with built-in commands and user-defined commands from .swifty/commands/
- Skill installation from URLs

### Agent Orchestration

- Subagent spawning with built-in agent types: general-purpose, plan (read-only architect), explore (read-only code explorer)
- Team coordination with file-based mailboxes and lead/member communication
- Coordinator mode for managing multi-agent workflows
- Git worktree isolation for parallel agent tasks

### Hooks

- Event-driven hook engine supporting: session_start, session_end, turn_start, turn_end, pre_send, post_receive, pre_tool_use, post_tool_use, shutdown
- Hook actions: shell commands, HTTP requests, prompt injection
- Conditional execution, reject-on-failure, and async options

### Remote Mode

- Koa HTTP server with WebSocket bridge for browser-based access
- React frontend served at a configurable address
- Bidirectional message streaming between browser and agent

## Installation

```bash
npm install -g @swifty.js/swifty
```

Or run directly from the monorepo:

```bash
pnpm dev
```

## Configuration

Swifty reads YAML configuration files from multiple locations, merged in order:

1. ~/.swifty/config.yml or ~/.swifty/config.yaml
2. .swifty/config.yml or .swifty/config.yaml (project root)
3. .swifty/config.local.yml or .swifty/config.local.yaml (project root, gitignored)

At least one provider must be configured. Example config.yml:

```yaml
providers:
  - name: anthropic
    protocol: anthropic
    base_url: https://api.anthropic.com
    model: claude-sonnet-4-20250514
    # api_key defaults to $ANTHROPIC_API_KEY

permission_mode: default

mcp_servers:
  - name: database
    command: npx
    args: ["-y", "@swifty-db/mcp@latest"]
    env: # map<string, string>; ${VAR} / $VAR expands from the environment
      API_BASE_URL: "https://swifty-db.dev"
      API_KEY: "${DATABASE_API_KEY}"

hooks:
  - event: pre_tool_use
    condition: "Bash"
    action:
      type: command
      command: "echo tool about to run"

sandbox:
  enabled: false
  auto_allow: false
  network_enabled: true

enable_coordinator_mode: false
```

Provider fields:

| Field             | Required | Description                                                          |
| ----------------- | -------- | -------------------------------------------------------------------- |
| name              | yes      | Display name for the provider                                        |
| protocol          | yes      | One of: anthropic, openai, openai-compat                             |
| base_url          | yes      | API base URL                                                         |
| model             | yes      | Model identifier                                                     |
| api_key           | no       | API key (falls back to environment variable)                         |
| thinking          | no       | Enable extended thinking mode (increases max_output_tokens to 64000) |
| context_window    | no       | Override auto-detected context window size                           |
| max_output_tokens | no       | Override default max output tokens                                   |

API keys are resolved in this order: explicit api_key field, then environment variables (ANTHROPIC_API_KEY for anthropic, OPENAI_API_KEY for openai and openai-compat).

## Usage

### Interactive TUI Mode

```bash
swifty
```

Launches the terminal interface. If multiple providers are configured, a provider selection screen appears first.

### Print Mode (Non-Interactive)

```bash
swifty -p "explain this codebase"
swifty -p "fix the failing test" --output-format stream-json
```

The -p flag sends a single prompt, runs the agent loop, and prints the result to stdout. Useful for scripting and CI pipelines.

### Remote Mode (Browser UI)

```bash
swifty --remote            # listens on :18888
swifty --remote :9000      # custom address
```

Starts a Koa HTTP server and WebSocket bridge. The bundled React frontend is served at the configured address for browser-based interaction.

### Slash Commands

Inside the TUI, these commands are available:

| Command                 | Description                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------- |
| /status                 | Show current session status (model, tokens, tools, sandbox, memories, skills, MCP) |
| /permission mode <mode> | Change permission mode (default, acceptEdits, plan, bypassPermissions)             |
| /memory                 | List stored memories                                                               |
| /memory clear           | Clear all memories                                                                 |
| /skills                 | List available skills                                                              |
| /skills reload          | Hot-reload skills from disk                                                        |
| /skill <name> [args]    | Run a skill by name                                                                |
| /plan                   | Enter plan mode (read-only investigation)                                          |
| /do                     | Exit plan mode and execute the approved plan                                       |
| /compact                | Force conversation compaction                                                      |
| /clear                  | Reset the session and clear the terminal                                           |
| /resume [id]            | List or restore a previous session                                                 |
| /rewind                 | Open checkpoint rewind dialog                                                      |
| /sandbox [1/2/3]        | Configure sandbox (1=on+auto, 2=on+manual, 3=off)                                  |
| /worktree               | List git worktrees                                                                 |
| /mcp                    | Show MCP server status                                                             |
| /quit                   | Exit the application                                                               |

### Keyboard Shortcuts

| Key       | Action                                                               |
| --------- | -------------------------------------------------------------------- |
| Ctrl+C    | Interrupt streaming (first press), exit app (second press within 2s) |
| Ctrl+O    | Toggle full vs. truncated tool output                                |
| Ctrl+T    | Toggle Teams dialog overlay                                          |
| Shift+Tab | Cycle permission modes                                               |
