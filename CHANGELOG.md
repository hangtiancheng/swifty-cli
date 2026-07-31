# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **apps/swifty**: VSCode integration — select code in the editor and press `Cmd+Option+K` (macOS; `Ctrl+Alt+K` elsewhere) to insert a `@path#L3-10` reference into the CLI input box. Implemented by reusing the already-installed `anthropic.claude-code` VSCode extension's embedded WebSocket MCP server; the extension side needs no changes and swifty ships no extension of its own.
  - New module `src/vscode/` (3 files):
    - `lockfile.ts` — service discovery. Scans `~/.claude/ide/<port>.lock` (honors the `CLAUDE_CONFIG_DIR` env override), validates lockfile JSON with a zod schema (`workspaceFolders`, `pid`, `ideName`, `transport`, `authToken`), and picks the extension instance for this terminal: first by `CLAUDE_CODE_SSE_PORT` env match (injected by the extension into its integrated terminals), falling back to an unambiguous cwd-inside-workspaceFolders match (NFC-normalized for macOS NFD paths). Only `transport: "ws"` lockfiles are supported.
    - `ws-transport.ts` — an MCP `Transport` implementation over `ws` (the MCP SDK ships no WebSocket client transport), connecting with subprotocol `mcp` and explicitly converting `RawData` (`Buffer | ArrayBuffer | Buffer[]`) to utf-8 before JSON parsing.
    - `ide-client.ts` — `connectToIde()`: polls discovery for up to 30s when inside an IDE terminal (`CLAUDE_CODE_SSE_PORT` set or `TERM_PROGRAM=vscode`), authenticates with the `X-Claude-Code-Ide-Authorization: <authToken>` header, announces itself with an `ide_connected { pid }` notification (the extension routes the keybinding to the CLI whose pid sits in the active terminal's process tree), and registers a handler for `at_mentioned { filePath, lineStart, lineEnd }` notifications (0-based lines, converted to 1-based). Note: the extension sends a file-path/line-range reference, not the selected text itself.
  - `src/tui/input.tsx`: `InputBox` gained an `insertTextRef` prop exposing an insert-at-cursor function (pads a leading space when the preceding character is not whitespace), enabling programmatic text injection without refactoring the component.
  - `src/tui/app.tsx`: connects on mount, shows an "IDE connected: <name>" system message, and turns each `at_mentioned` notification into `@<relative-path>#L<start>[-<end>]` inserted at the input cursor.
  - `src/tui/at-expand.ts`: `expandAtRefs` / `expandAtRefsWithImages` now parse an optional `#L3` / `#L3-10` suffix and inline only the referenced lines as `<file path="…" lines="3-10">…</file>` at submit time (files up to 10 MB are sliced; the resulting snippet still honors the 100 KB inline cap).
  - Caveat: this depends on the third-party extension's undocumented protocol (lockfile format, auth header, notification methods), which may change without notice; if another Claude-compatible CLI runs in the same window, the extension routes the keybinding by terminal pid.
- **apps/larky**: same `Cmd+Option+K` capability, adapted to the dual-process architecture:
  - `src/vscode/`, `src/tui/input.tsx`, and `src/tui/at-expand.ts` arrived via `apps/swifty-to-larky.mjs` (the `vscode` directory was added to the script's `SRC_DIRS`; brand renaming turns the MCP client name into `larky` automatically).
  - `src/tui/app.tsx` (PROTECTED, hand-edited): the IDE connection lives in the **TUI process**, because it is the process running inside the IDE's integrated terminal — the extension routes the keybinding by terminal pid, which the background daemon can never satisfy. Mentions are inserted locally via `insertTextRef`; the submitted text travels to the daemon unchanged over the existing `session.send_message` RPC.
  - The **daemon needed zero changes**: `core/agent-session.ts` already expands `@` references at submit time through `expandAtRefsWithImages`, which picked up `#L` range support from the synced `at-expand.ts`.
  - Verification for both apps: typecheck, eslint, and full test suites pass (swifty 278, larky 373). End-to-end behavior requires a real VSCode window with the Claude Code extension: launch the CLI in the integrated terminal, wait for "IDE connected", select code, press `Cmd+Option+K`.

### Changed

- **apps/larky**: Aligned with the latest `apps/swifty` changes via `apps/swifty-to-larky.mjs` plus a manual rework of the dual-process-specific `src/core/agent-session.ts`:
  - The skill listing is no longer embedded in the system prompt. It is now project-scoped and injected into the conversation through the first `system-reminder` message (`conversation.injectLongTermMemory`), keeping the system prompt project-agnostic and preserving the cross-project prompt-cache prefix.
  - Added incremental skill announcements (`skillDelta`): skills discovered mid-session (install, `/skills reload`, catalog hot-reload) are delivered as delta `system-reminder` messages instead of rewriting the system prompt.
  - Instruction discovery now includes `.larky/LARKY.md` in every directory from the git root down to the working directory; legacy `.larky/INSTRUCTIONS.md` support was removed.

### Fixed

- **apps/larky**: `tests/agent-session-cancel.test.ts` failed on developer machines with populated `~/.larky/memory` directories. The per-run memory recall (`MemoryManager.findRelevantMemories`) issued a selector LLM call through the same scripted test client, consuming a script slot and breaking strict `started.length === 1` waits. The suite now redirects `HOME`/`USERPROFILE` to an empty temporary directory (test isolation fix; no production code change). Side benefit: file runtime dropped from ~46s to ~3s.

### Known Issues

- **Environment-dependent tests (not yet fixed)**: Several test files in `apps/swifty` and their synced copies in `apps/larky` read the real user home directory instead of an isolated one. They currently pass, but their assertions are sensitive to user-global state and may fail or produce false positives on machines with certain `~/.swifty` (or `~/.larky`) contents:
  - `tests/memory.test.ts` — `MemoryManager.buildSystemReminder()` also scans `~/.swifty/memory`; the "no WARNING below the 200-line cap" assertion can flip once a user's global memory entries push the combined index past the truncation threshold.
  - `tests/skills.test.ts` — `SkillCatalog.load()` also scans the global skill directories (`~/.trae/skills`, `~/.claude/skills`, `~/.github/skills`, `~/.swifty/skills`); a user-global skill whose name collides with a fixture (e.g. `audit-deps`) would shadow or corrupt the lookup-by-name assertions.
  - `tests/instructions.test.ts` — `loadInstructions()` also reads user-global `~/.swifty/SWIFTY.md` / `~/.swifty/AGENTS.md`; assertions rely on `toContain` and relative ordering and would break if user-global content collides with fixture markers.

  Planned remediation: adopt the existing `HOME`/`USERPROFILE` redirection pattern (see `tests/teams.test.ts`) in these files in `apps/swifty`, then propagate to `apps/larky` via `apps/swifty-to-larky.mjs`.
