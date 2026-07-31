#!/usr/bin/env bash
# Copyright (c) 2026 hangtiancheng
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

# larky.sh — Bootstrap installer for larky CLI via npm global install.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/larky.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/larky.sh | bash -s -- --alpha
#
# Installs @swifty.js/larky globally via npm. npm's `bin` field automatically
# creates the `larky` command on PATH. Requires Node.js >= 20.
#
# Supports: --uninstall, --version vX.Y.Z, --alpha, --beta, --rc, --canary, --nightly, --tag=NAME

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────
PACKAGE="@swifty.js/larky"
NODE_MAJOR_MIN=20

# ── Helpers ────────────────────────────────────────────────────────────
info() { printf '\033[36m[info]\033[0m  %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m  %s\n' "$*"; }
err() { printf '\033[31m[err]\033[0m  %s\n' "$*" >&2; }
ok() { printf '\033[32m[ok]\033[0m  %s\n' "$*"; }

# ── Parse args ─────────────────────────────────────────────────────────
ACTION="install"
VERSION=""
TAG=""
for arg in "$@"; do
	case "$arg" in
	--uninstall) ACTION="uninstall" ;;
	--version=*) VERSION="${arg#--version=}" ;;
	--alpha) TAG="alpha" ;;
	--beta) TAG="beta" ;;
	--rc) TAG="rc" ;;
	--canary) TAG="canary" ;;
	--nightly) TAG="nightly" ;;
	--dev) TAG="dev" ;;
	--tag=*) TAG="${arg#--tag=}" ;;
	--help | -h)
		cat <<EOF
Usage: larky.sh [OPTIONS]

  (default)    Install the latest stable larky from npm
  --uninstall  Uninstall larky
  --version=   Install a specific version (e.g. --version=0.1.0)
  --alpha      Install from the 'alpha' dist-tag
  --beta       Install from the 'beta' dist-tag
  --rc         Install from the 'rc' dist-tag
  --canary     Install from the 'canary' dist-tag
  --nightly    Install from the 'nightly' dist-tag
  --dev        Install from the 'dev' dist-tag
  --tag=NAME   Install from a custom npm dist-tag

Examples:
  curl -fsSL <url> | bash                           # latest stable
  curl -fsSL <url> | bash -s -- --canary            # canary build
  curl -fsSL <url> | bash -s -- --version=0.1.0     # specific version

Requires Node.js >= $NODE_MAJOR_MIN and npm.
EOF
		exit 0
		;;
	*)
		err "Unknown option: $arg"
		exit 1
		;;
	esac
done

# ── Uninstall ──────────────────────────────────────────────────────────
if [ "$ACTION" = "uninstall" ]; then
	info "Uninstalling $PACKAGE..."
	npm uninstall -g "$PACKAGE"
	ok "larky uninstalled"
	exit 0
fi

# ── Write default config (skip if it already exists) ─────────────────
CONFIG_DIR="$HOME/.larky"
CONFIG_FILE="$CONFIG_DIR/config.yaml"
if [ -f "$CONFIG_FILE" ]; then
	info "Config already exists at $CONFIG_FILE."
else
	mkdir -p "$CONFIG_DIR"
	cat >"$CONFIG_FILE" <<'EOF'
# Larky project-level configuration (.larky/config.yaml)
#
# Precedence (lowest to highest):
#   built-in defaults < ~/.larky/config.yaml (global) < .larky/config.yaml (project) < .env < LARKY_* environment variables
# If the LARKY_CONFIG environment variable is set, only that single file is loaded instead.
#
# Every section and every key below is OPTIONAL unless marked required.
# Omitted keys fall back to their defaults. Unknown sections or keys are fatal (startup exits with code 1).
# Schema source: src/core/config.ts

[core]
host = "127.0.0.1" # optional, string, default: "127.0.0.1" — daemon listen address (env: LARKY_HOST)
port = 5520 # optional, integer, default: 5520 — daemon listen port (env: LARKY_PORT)

[logging]
file = "~/.larky/logs/core.log" # optional, string, default: "~/.larky/logs/core.log" — log file path (env: LARKY_LOG_FILE)
format = "text" # optional, string, default: "text" — "text" or "json" (env: LARKY_LOG_FORMAT)
level = "INFO" # optional, string, default: "INFO" — log level (env: LARKY_LOG_LEVEL)

[agent]
max_steps = 20 # optional, positive integer, default: 20 — maximum agent steps per task (env: LARKY_MAX_STEPS)

[llm]
default_model = "claude-sonnet-4-6" # optional, string, default: "claude-sonnet-4-6" — default model (env: LARKY_LLM_DEFAULT_MODEL)
router = "static" # optional, string, default: "static" — model routing strategy; reserved, "static" is the only implemented strategy (no env override)
base_url = "" # optional, string, default: "" — Anthropic API base URL; empty means SDK default (env: ANTHROPIC_BASE_URL)
api_key = "" # optional, string, default: "" — Anthropic API key; must be set here or via env (env: ANTHROPIC_API_KEY)

[trace]
enabled = true # optional, boolean, default: true — enable tracing (env: LARKY_TRACE_ENABLED)
file = "~/.larky/traces/daemon.jsonl" # optional, string, default: "~/.larky/traces/daemon.jsonl" — trace output file (env: LARKY_TRACE_FILE)
include_llm_payload = true # optional, boolean, default: true — include LLM request/response payloads in traces (env: LARKY_TRACE_INCLUDE_LLM_PAYLOAD)

[permission]
timeout_s = 60.0 # optional, number >= 0, default: 60.0 — permission prompt timeout in seconds (env: LARKY_PERMISSION_TIMEOUT_S)

[compaction]
auto_threshold = 0.0 # optional, number in [0, 1], default: 0.0 (disabled) — auto-compaction trigger threshold (env: LARKY_COMPACT_THRESHOLD)
tool_result_keep = 4000 # optional, positive integer, default: 4000 — length retained after truncation (env: LARKY_COMPACT_TOOL_KEEP)
tool_result_limit = 8000 # optional, positive integer, default: 8000 — truncate tool results longer than this (env: LARKY_COMPACT_TOOL_LIMIT)

# MCP servers — optional; default: [] (no servers). Declare one [[mcp.servers]] block per server.
# No environment variable overrides exist for MCP servers.
#
# [[mcp.servers]]
# name = "my-stdio-server"      # REQUIRED, non-empty string — unique server name
# transport = "stdio"           # optional, "stdio" or "tcp", default: "stdio"
# command = "npx"               # optional, string, default: "" — executable for stdio transport
# args = ["-y", "@my/mcp-server"]        # optional, array of strings, default: []
# env = { API_KEY = "your-api-key" }     # optional, table of strings, default: {}
#
# [[mcp.servers]]
# name = "my-tcp-server"        # REQUIRED, non-empty string
# transport = "tcp"             # optional, default: "stdio"
# host = "localhost"            # optional, string, default: "localhost" — used by tcp transport
# port = 3000                   # optional, integer, default: 3000 — used by tcp transport
EOF
	ok "Wrote default config to $CONFIG_FILE"
fi

# ── Check Node.js ─────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
	err "Node.js not found. Install Node.js >= $NODE_MAJOR_MIN first:"
	err "  https://nodejs.org/  or  brew install node@20"
	exit 1
fi
NODE_VERSION="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_VERSION" -lt "$NODE_MAJOR_MIN" ]; then
	err "Node.js $NODE_VERSION detected, need >= $NODE_MAJOR_MIN. Please upgrade."
	exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
	err "npm not found. It ships with Node.js — reinstall Node.js from https://nodejs.org/"
	exit 1
fi

# ── Install ─────────────────────────────────────────────────────────
# Priority: --version > --tag > --alpha/beta/rc/canary/nightly > latest.
if [ -n "$VERSION" ]; then
	# Strip leading 'v' if user passed v0.1.0
	VERSION="${VERSION#v}"
	PKG_VERSION="$PACKAGE@$VERSION"
elif [ -n "$TAG" ]; then
	PKG_VERSION="$PACKAGE@$TAG"
else
	PKG_VERSION="$PACKAGE@latest"
fi

info "Installing $PKG_VERSION globally..."
npm install -g "$PKG_VERSION" --registry=https://registry.npmjs.org/

# ── Verify ────────────────────────────────────────────────────────────
# npm global bin should be on PATH. If not, print the prefix/bin hint.
NPM_BIN="$(npm config get prefix 2>/dev/null)/bin"
if command -v larky >/dev/null 2>&1; then
	ok "larky installed successfully"
	LARKY_VERSION="$(npm ls -g "$PACKAGE" --depth=0 2>/dev/null | grep -o "$PACKAGE@[^ ]*" | head -n1 || true)"
	[ -n "$LARKY_VERSION" ] && info "Installed: $LARKY_VERSION"
else
	warn "Installation completed but 'larky' is not on your PATH."
	warn "Add npm's global bin to your shell profile (~/.bashrc / ~/.zshrc):"
	warn "  export PATH=\"$NPM_BIN:\$PATH\""
fi

ok 'Download Claude Code VSCode plugin and enjoy larky!!!'
