# @swifty.js/glob-wasm

Glob matching and scanning for Node.js, powered by **WebAssembly** — an
[AssemblyScript](https://www.assemblyscript.org/) port of a native glob addon,
embedded as a `.wasm` binary and wrapped in a typed `Glob` class.

[![npm](https://img.shields.io/npm/v/@swifty.js/glob-wasm?label=npm&color=F05138)](https://www.npmjs.com/package/@swifty.js/glob-wasm)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5a623.svg)](../../LICENSE)

## Installation

```sh
pnpm add @swifty.js/glob-wasm
```

## Usage

```ts
import { Glob } from "@swifty.js/glob-wasm";

const glob = new Glob("src/**/*.ts", { dot: false });

glob.match("src/index.ts"); // true

const files = glob.scan({
  cwd: process.cwd(),
  exclude: ["**/node_modules/**"],
  dot: false,
  maxResults: 1000,
});
```

## Pattern syntax

| Syntax      | Meaning                                 |
| ----------- | --------------------------------------- |
| `*`         | Matches within a single path segment    |
| `**`        | Matches zero or more whole segments     |
| `?`         | Matches a single character              |
| `[a-z]`     | Character class; `[!a-z]` negates       |
| `{a,b}`     | Alternates (nestable, expansion capped) |
| `\`         | Escapes the next character              |
| leading `!` | Negation                                |

Scan semantics match `minimatch`/`picomatch`: wildcards never match a leading
dot unless `dot` is set (but literal `.` segments always match), symlinks are
never followed, and patterns are capped at **64 KiB**.

## API

### `new Glob(pattern, options?)`

| Option | Type      | Default | Description                       |
| ------ | --------- | ------- | --------------------------------- |
| `dot`  | `boolean` | `false` | Allow wildcards to match dotfiles |

### `glob.match(text)` → `boolean`

Matches a single path string against the compiled pattern.

### `glob.scan(options?)` → `string[]`

Recursively walks the filesystem and returns matching paths.

| Option       | Type       | Description                 |
| ------------ | ---------- | --------------------------- |
| `cwd`        | `string`   | Root directory to scan from |
| `exclude`    | `string[]` | Glob patterns to skip       |
| `dot`        | `boolean`  | Allow matching dotfiles     |
| `maxResults` | `number`   | Cap on returned results     |

## Layout

```
glob-wasm/
├── assembly/       # AssemblyScript glob implementation
├── glob.ts         # typed Node.js wrapper (wasm loading + memory marshaling)
├── tools/          # wasm embedding helpers
└── test/           # node:test suite
```
