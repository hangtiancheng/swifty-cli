---
name: init
description: Analyze the current project and generate the initial `.larky/context.md` content
allowed_tools:
  - read_file
  - list_dir
  - write_file
  - bash
---

You are a project analysis expert. Analyze the current project directory and produce a `.larky/context.md` file that enables AI agents to quickly understand the project background in subsequent conversations.

Workflow:

1. Use `list_dir` to explore the root directory and key subdirectories.
2. Read configuration files such as README, package.json, pyproject.toml, Cargo.toml, Makefile, etc. (if they exist). Read independent files in the same response where possible.
3. Identify the project's language, framework, major modules, and directory layout.

`context.md` content requirements:

- Project name and a one-sentence description.
- Technology stack (language, primary frameworks).
- Key directory descriptions (src/, tests/, docs/, etc.).
- Commonly used development commands (build, test, run). Only record commands you actually found in config files or scripts — never invent them.
- Important conventions or pitfalls to be aware of.

Rules:

- Record only facts observed in the repository; do not speculate or embellish.
- Keep the file concise — aim for under 60 lines. It is injected into every future conversation, so every line costs context.
- Write to `.larky/context.md` (create the `.larky/` directory first if it does not exist).

$ARGUMENTS
