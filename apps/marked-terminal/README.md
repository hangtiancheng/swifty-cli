# @swifty.js/marked-terminal

A `marked` extension that renders Markdown into styled **terminal output** — color
headings with `chalk`, formatted tables via `cli-table3`, syntax-highlighted code
blocks via `cli-highlight`, emoji substitution via `node-emoji`, and hyperlink
support via `supports-hyperlinks`.

A maintained fork of the classic `marked-terminal`, kept in lock-step with the
`marked` parser API.

[![npm](https://img.shields.io/npm/v/@swifty.js/marked-terminal?label=npm&color=F05138)](https://www.npmjs.com/package/@swifty.js/marked-terminal)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5a623.svg)](../../LICENSE)

## Installation

```sh
pnpm add @swifty.js/marked-terminal
```

This requires `marked` as a peer dependency:

```sh
pnpm add marked
```

## Usage

```ts
import { marked } from "marked";
import { markedTerminal } from "@swifty.js/marked-terminal";

marked.use(
  markedTerminal({
    unescape: true, // unescape HTML entities
    emoji: true, // replace `:emoji:` shortcodes
    reflowText: true, // reflow paragraphs to the terminal width
  }),
);

const html = await marked.parse(
  "# Hello\n\nSome **bold** text and a `code` span.",
);
console.log(html);
```

The default export is the low-level `Renderer`, while `markedTerminal(options?)`
returns a ready-to-use `MarkedExtension` for `marked.use(...)`.

## Available options

| Option              | Type      | Default | Description                               |
| ------------------- | --------- | ------- | ----------------------------------------- |
| `unescape`          | `boolean` | `false` | Unescape HTML entities in text            |
| `emoji`             | `boolean` | `true`  | Replace `:emoji:` shortcodes              |
| `reflowText`        | `boolean` | `false` | Reflow paragraphs to terminal width       |
| `showSectionPrefix` | `boolean` | `true`  | Prefix headings with a `#` section marker |
| `tab`               | `number`  | `3`     | Tab size for code indentation             |
| `width`             | `number`  | `80`    | Target width used by the table layout     |
| `headingStyle`      | object    | —       | Per-level heading `chalk` styles          |
| `codeStyle`         | object    | —       | Code-block `chalk` styles                 |
| `tableOptions`      | object    | —       | Passthrough to `cli-table3`               |

A `highlightOptions` object may also be passed as a second argument to configure
`cli-highlight`.

## Why the fork?

`marked-terminal` did not keep pace with the `marked` major-version API
(marked v23+), breaking its renderer contract. This fork adapts the renderer to
the modern `MarkedExtension<string, string>` shape while preserving the original
visual output, so it can be `marked.use(...)`-ed directly as a self-contained
token renderer.

## Layout

```
marked-terminal/
├── index.ts          # renderer + markedTerminal() extension
├── rollup.config.js  # dual ESM/CJS build
└── package.json
```
