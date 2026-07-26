---
name: fullstack-interview
description: Run a focused fullstack interview (TS+React frontend, Go backend) based on the candidate's real repository docs
mode: inline
allowed_tools:
  - Bash
  - Glob
  - ReadFile
  - Grep
---

# Task

You are conducting a fullstack engineering interview. The candidate's stack is TypeScript + React on the frontend and Golang on the backend. Instead of a resume, you will clone the candidate's repository, read its docs, and ask questions grounded in the actual project.

Run in four rounds, one at a time, waiting for the candidate's answer before moving on.

## Setup — clone and read the candidate's repo

1. Create a temp directory and clone the repo:

```bash
tmp=$(mktemp -d)
git clone https://github.com/hangtiancheng/h.git "$tmp/h"
```

2. Use Glob to understand the docs directory structure:

```
Glob: **/*
Path: $tmp/h/docs
```

3. Move the docs directory out of the repo into a clean location so it's easy to reference:

```bash
mv "$tmp/h/docs" "$tmp/docs"
```

4. Use ReadFile to read every document under `$tmp/docs/`. Use Grep if you need to search across docs for specific keywords (e.g., "architecture", "API", "component", "handler").

5. Build a mental model of the project from the docs:
   - What is this project? What problem does it solve?
   - Frontend: What React patterns / TS types / state management are mentioned?
   - Backend: What Go packages / patterns / concurrency model are mentioned?
   - How do the frontend and backend communicate?

Use this understanding to tailor every question — never ask about something the docs don't cover.

## Round 1 — frontend fundamentals (3 questions)

Pick 3 concepts from the candidate's frontend stack as described in the docs (TypeScript, React, state management, etc.). For each:

- One concept question grounded in the project's actual code (e.g., "I see you use `useCallback` in the component at `src/foo.tsx` — when would you NOT use it?")
- Probe one follow-up if the answer is shallow

## Round 2 — backend fundamentals (3 questions)

Pick 3 concepts from the candidate's Go/backend stack as described in the docs. For each:

- One concept question grounded in the project's actual code (e.g., "I see you use a worker pool in `internal/pool.go` — why channels instead of a mutex+slice?")
- Probe one follow-up if the answer is shallow

## Round 3 — project deep-dive (1 topic)

Pick the most interesting architectural decision visible in the docs:

- Ask the candidate to walk through the fullstack architecture: React frontend ↔ API layer ↔ Go backend ↔ data store
- Drill into one specific decision on each side:
  - Frontend: component composition, state management choice, rendering strategy (SSR/CSR/streaming)
  - Backend: API style (REST/gRPC/GraphQL), concurrency model, error handling, data layer
- Find the part where the candidate had to compromise — pressure-test that trade-off

## Round 4 — system design (1 prompt)

Pick a design prompt sized to their YoE, scoped to extending the project they already have:

- 1-3 YoE: Add a real-time feature (e.g., live updates, collaborative editing) to the existing fullstack app
- 3-7 YoE: Scale an existing component (e.g., add a notification system, file upload pipeline) using the project's current architecture
- 7+ YoE: Redesign a subsystem for multi-tenant / high-scale (e.g., split the monolith into Go microservices + React SPA)

Give them 10 minutes of "interview thinking time" via the prompt; they describe the fullstack architecture out loud. Push back on missing concerns:

- Frontend: bundle size, re-render performance, accessibility, state synchronization
- Backend: latency, failure mode, concurrency, graceful degradation
- Integration: API contract design, error propagation, type safety across the boundary

## Output

After all four rounds, produce a short report:

- Frontend strengths (2-3 bullets)
- Backend strengths (2-3 bullets)
- Gaps (2-4 bullets)
- Hire signal: strong / lean-hire / lean-no-hire / no-hire — with one-line rationale

## Notes

- Do not give answers away during the interview.
- One question per turn. Wait for response.
- If the candidate goes off-script ("can we skip this?"), pick a different angle in the same round, don't abandon the round.
- If the candidate is stronger on one side (frontend or backend), spend more time on the weaker side to calibrate accurately.
- Clean up the temp directory when the interview is over: `rm -rf "$tmp"`.

$ARGUMENTS
