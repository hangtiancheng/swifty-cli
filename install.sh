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

# install.sh — Bootstrap installer for swifty CLI via npm global install.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/install.sh | bash -s -- --alpha
#
# Installs @swifty.js/swifty globally via npm. npm's `bin` field automatically
# creates the `swifty` command on PATH. Requires Node.js >= 20.
#
# Supports: --uninstall, --version vX.Y.Z, --alpha, --beta, --rc, --canary, --nightly, --tag=NAME

echo "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣠⠤⠤⠤⠤⣄⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⠶⠋⠉⠀⠀⠀⠀⠀⠀⠀⠀⠉⠙⠢⣄⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡴⠋⠁⠀⠀⠀⠀⢀⣀⡐⢄⠀⠀⠀⠀⠀⠀⠈⠳⣄⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡞⠁⠀⠀⠀⠀⠀⡜⠁⠀⣿⡌⠀⠀⠀⠀⠀⠀⠀⠀⠈⢆⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡾⠀⠀⠀⠀⠀⠀⣸⣷⣤⣾⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠊⣼⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⢤⡀⠀⠀⠀⢰⡇⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⠇⠀⠀⠀⠀⠀⠀⠀⠀⡜⣼⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡎⠀⠉⠲⣄⣀⣼⡇⠀⠀⠀⠀⠀⠀⠻⠿⣿⣟⡼⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠉⠉⠁⠀⡏⠑⠌⠓⢬⣧⠀⠀⠀⠀⠘⢄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⠿⡀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣇⠀⠀⠀⠇⠀⠀⠀⠀⠙⣆⠀⠀⠀⠀⠀⠈⠉⠓⠒⠲⠤⢤⣀⠀⠂⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀
⠀⠀⠀⠀⢀⣠⠤⠖⠒⠒⠒⠦⢤⡀⠀⠀⠀⠀⠀⢸⡄⠀⠀⠀⠀⠀⠀⠀⠀⠈⢦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠲⠤⠤⠒⠋⢉⠟⠀⠀⠀⠀
⠀⠀⢀⡴⠋⠁⠀⠀⠀⠀⠀⠀⠀⠙⢦⠀⠀⠀⢠⡞⠹⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⣦⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡠⠋⠀⠀⠀⠀⠀
⠀⣠⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢇⠀⢠⡟⠀⠀⠹⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⡏⠈⠑⠢⢤⣀⣀⠀⠀⠀⠀⢀⣀⡤⠖⠯⣀⠀⠀⠀⠀⠀⠀
⢀⡟⠀⠀⠀⠀⠠⠴⠤⣀⠀⠀⠀⠀⠀⢸⣠⡟⠀⠀⠀⠀⢹⣄⠀⠀⠀⠀⠀⠀⢀⣼⡁⠀⠀⠀⠀⠀⠈⠉⠉⠉⠉⢻⠀⠀⠀⠀⠀⠉⠢⣄⣀⡀⠀
⢸⡇⠀⠀⠀⠀⠀⠀⠀⠘⡆⠀⠀⠀⠀⢈⣿⡇⠀⠀⠀⠀⢸⠉⢢⣀⡀⢀⣀⣴⠟⠀⠙⢦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠸⡆⠀⠀⠀⠀⠀⠀⠀⠀⢇⡀
⠘⣇⠀⠀⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⢸⡇⣷⠀⠀⠀⢀⡞⠀⢰⠏⠉⠉⠁⢸⡀⠀⠀⠀⠈⠓⠶⠤⣤⣄⣀⣠⡤⠴⡇⠀⠀⠀⠀⠀⠀⠀⠀⡔⠁
⠀⠹⣆⠀⠀⠀⠀⠀⢀⡼⠁⠀⠀⠀⠀⢸⠁⠸⡆⠀⣠⠞⠀⢀⡞⠀⠀⠀⠀⠘⡇⠀⠀⠀⠀⠀⠀⠀⠀⢸⠃⠀⠀⢰⣧⣀⣀⡀⠀⢀⣀⣠⠴⠃⠀
⠀⠀⠹⡓⠦⠤⠤⠖⠋⠀⠀⠀⠀⠀⠀⢸⠀⠀⠹⡴⠁⠀⢠⠞⠀⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀⡞⠀⠀⠀⣸⠀⠀⠉⠉⠉⠉⠀⠀⠀⠀⠀
⠀⠀⠀⠘⢆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠀⠀⢸⢁⡠⠴⢧⡀⠀⠀⠀⠀⣀⠔⠳⣄⠀⠀⠀⠀⠀⠀⡼⠁⠀⠀⢠⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠑⢄⠀⠀⠀⠀⠀⠀⠀⠀⠘⣇⣠⡿⠋⠀⠀⠀⠙⢦⣀⡠⠞⠁⠀⠀⠈⠙⠶⣤⣀⡀⣰⠃⠀⠀⣠⡏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠙⢦⣀⠀⠀⠀⠀⠀⠀⣸⠏⠀⠀⠀⠀⠀⠀⠈⢻⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⣹⠋⠉⠉⣹⠏⠙⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠑⠲⢤⣄⣀⣠⡏⠀⠀⠀⠀⠀⠀⠀⠀⠈⣇⠀⠀⠀⠀⠀⠀⠀⠀⡰⠃⢀⣤⠞⠁⠀⠀⠘⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⡽⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣻⠶⠤⠤⠤⠤⠤⢤⣞⡥⠖⠋⠀⠀⠀⠀⠀⠀⢹⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠟⠒⠀⠀⠒⠒⠺⢯⡁⠀⠀⠀⠀⠀⠀⠀⠀⠀⣾⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⠎⠀⠀⠀⠀⠀⠀⠀⠀⠀⡴⠃⠀⠀⠀⠀⠀⠀⠀⠀⠙⢦⡀⠀⠀⠀⠀⠀⠀⠀⢄⣈⠆⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠳⢄⡀⠀⠀⠀⠀⠀⠀⢀⠞⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⣄⠀⠀⠀⠀⢀⣠⠴⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢇⣀⡤⠖⢄⠀⣰⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠳⠒⠒⠋⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠀⠈⠙⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀"

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────
PACKAGE="@swifty.js/swifty"
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
Usage: install.sh [OPTIONS]

  (default)    Install the latest stable swifty from npm
  --uninstall  Uninstall swifty
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
	ok "swifty uninstalled"
	exit 0
fi

# ── Write default config (skip if it already exists) ─────────────────
CONFIG_DIR="$HOME/.swifty"
CONFIG_FILE="$CONFIG_DIR/config.yaml"
if [ -f "$CONFIG_FILE" ]; then
	info "Config already exists at $CONFIG_FILE."
else
	mkdir -p "$CONFIG_DIR"
	cat > "$CONFIG_FILE" <<'EOF'
# Swifty global configuration (~/.swifty/config.yaml)
# Permission mode: "default" | "acceptEdits" | "plan" | "bypassPermissions"
permission_mode: bypassPermissions

# LLM providers — at least one is required.
# api_key is intentionally left empty; it falls back to the ANTHROPIC_API_KEY
# (or OPENAI_API_KEY) environment variable at runtime.
providers:
  - name: anthropic
    protocol: anthropic
    base_url: https://api.deepseek.com/anthropic
    model: "deepseek-v4-flash"
    api_key: "sk-"
    thinking: true
    # max_output_tokens: 1000000
    context_window: 1000000 # override the built-in lookup if needed

  - name: openai-compat
    # protocol: anthropic
    protocol: openai-compat
    base_url: https://api.deepseek.com
    model: "deepseek-v4-flash"
    api_key: "sk-"
    thinking: true
    # max_output_tokens: 1000000 # override the default (8192, or 64000 with thinking)
    context_window: 1000000 # override the built-in lookup if needed

# MCP servers — optional, empty by default.
mcp_servers: []
  # Example: filesystem MCP server
  # - name: filesystem
  #   command: npx
  #   args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

# Hooks — optional, empty by default.
hooks: []
  # Example: lint after EditFile
  # - id: lint-on-edit
  #   event: post_tool_use
  #   condition: 'tool == "EditFile"'
  #   action:
  #     type: command
  #     command: npx eslint --fix "$SWIFTY_FILE_PATH"
  #   on_error: ignore
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
if command -v swifty >/dev/null 2>&1; then
	ok "Swifty installed successfully"
	SWIFTY_VERSION="$(swifty --version 2>/dev/null || true)"
	[ -n "$SWIFTY_VERSION" ] && info "Version: $SWIFTY_VERSION"
else
	warn "Installation completed but 'swifty' is not on your PATH."
	warn "Add npm's global bin to your shell profile (~/.bashrc / ~/.zshrc):"
	warn "  export PATH=\"$NPM_BIN:\$PATH\""
fi

ok 'Love & Peace, Enjoy Swifty!!!'
