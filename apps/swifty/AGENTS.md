@docs

## Project

Swifty is an AI coding assistant TUI built with React + Ink. It talks to LLM providers (Anthropic, OpenAI, OpenAI-compatible) via tool-calling conversations.

## Tech Stack

TypeScript, React, Ink, Zod, Vitest, ESLint, oxfmt, pnpm workspace deps: `@swifty.js/glob-addon`, `@swifty.js/glob-wasm`.

## Code Conventions

Enforced by `eslint.config.js`.

### Type safety

- No `any`, no `!`, no `@ts-ignore`, no `as` casts.
- All `no-unsafe-*` rules are errors.
- Validate runtime data with Zod.

### Imports

- Use `import type` for type-only imports.
- Include `.js` extensions in import paths.

### Style

- File names: kebab-case.
- Control flow: always use braces (`curly: "all"`).
- Unused vars: prefix with `_`.
- Promises: must be awaited or voided.
