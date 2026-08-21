# @swifty.js/glob-addon

High-performance glob matching and scanning for Node.js, powered by Rust.

## Supported Targets

| Platform | Architecture | Rust Target |
|----------|-------------|-------------|
| macOS    | arm64       | `aarch64-apple-darwin` |
| macOS    | x86_64      | `x86_64-apple-darwin` |
| Linux    | aarch64     | `aarch64-unknown-linux-gnu` |
| Linux    | x86_64      | `x86_64-unknown-linux-gnu` |
| Windows  | arm64       | `aarch64-pc-windows-gnullvm` |
| Windows  | x86_64      | `x86_64-pc-windows-gnu` |

## Prerequisites

Install Rust with rustup. If Rust was installed in the current terminal session, reload Cargo's environment first:

```bash
. "$HOME/.cargo/env"
```

## Building

### Native build

```bash
pnpm build
```

This builds the Rust addon in release mode, copies it to `build/Release/glob_addon.node`, and compiles the TypeScript wrapper.

### Cross-compilation

Build a single target:

```bash
pnpm cross:darwin-arm64
pnpm cross:darwin-x64
pnpm cross:linux-arm64
pnpm cross:linux-x64
pnpm cross:windows-arm64
pnpm cross:windows-x64
```

Build all targets:

```bash
pnpm cross
```

The build script installs the requested Rust target with `rustup target add` and writes outputs to `prebuilds/<platform>-<arch>/glob_addon.node`.

Some cross targets may require platform linkers or SDKs provided by the host environment.

## Testing

```bash
pnpm test
```
