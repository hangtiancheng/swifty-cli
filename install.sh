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
#
# Installs @swifty.js/swifty globally via npm. npm's `bin` field automatically
# creates the `swifty` command on PATH. Requires Node.js >= 20.
#
# Supports: --uninstall, --version vX.Y.Z, --alpha, --beta, --rc, --canary, --nightly, --tag=NAME

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
  --uninstall  Remove swifty globally
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
	INSTALL_SPEC="$PACKAGE@$VERSION"
elif [ -n "$TAG" ]; then
	INSTALL_SPEC="$PACKAGE@$TAG"
else
	INSTALL_SPEC="$PACKAGE@latest"
fi

info "Installing $INSTALL_SPEC globally..."
npm install -g "$INSTALL_SPEC"

# ── Verify ────────────────────────────────────────────────────────────
# npm global bin should be on PATH. If not, print the prefix/bin hint.
NPM_BIN="$(npm config get prefix 2>/dev/null)/bin"
if command -v swifty >/dev/null 2>&1; then
	ok "Swifty installed successfully"
	info "Version: $(swifty --version 2>/dev/null || echo 'unknown')"
	echo
	info "Run 'swifty' to get started."
else
	warn "Installation completed but 'swifty' is not on your PATH."
	warn "Add npm's global bin to your shell profile (~/.bashrc / ~/.zshrc):"
	warn "  export PATH=\"$NPM_BIN:\$PATH\""
fi
