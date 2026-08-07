# @swifty.js/glob-addon

High-performance glob matching and scanning for Node.js, powered by C++.

## Supported Targets

| Platform | Architecture | Zig Target |
|----------|-------------|------------|
| macOS    | arm64       | `aarch64-macos` |
| macOS    | x86_64      | `x86_64-macos` |
| Linux    | aarch64     | `aarch64-linux-gnu` |
| Linux    | x86_64      | `x86_64-linux-gnu` |
| Windows  | arm64       | `aarch64-windows-gnu` |
| Windows  | x86_64      | `x86_64-windows-gnu` |

## Prerequisites

All cross-compilation uses [Zig](https://ziglang.org/) as a universal C/C++ cross-compiler:

```bash
brew install zig
```

No other toolchains are needed.

## Building

### Native build (node-gyp)

```bash
pnpm build
```

### Native build (CMake)

```bash
pnpm cmake
```

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

Node.js headers (and `node.lib` for Windows) are downloaded automatically and cached under `cmake/node-headers/`.

Outputs are placed in `prebuilds/<platform>-<arch>/addon.node`.

### Manual cross-build

```bash
# 1. Download headers (once)
cmake -DNODE_VERSION=v24.16.0 -DTARGET_PLATFORM=linux -DTARGET_ARCH=arm64 \
  -P cmake/download-node-headers.cmake

# 2. Configure & build
cmake -S . -B build-linux-arm64 -G "Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE=cmake/toolchains/linux-arm64.cmake \
  -DNODE_HEADERS_DIR=cmake/node-headers/v24.16.0/linux-arm64/node-v24.16.0/include/node \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build-linux-arm64
```

## Testing

```bash
pnpm test
```
