# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
