/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Regression tests for run cancellation and blocking interactions:
 * - steering abort-controller handoff (P0-1/P0-4)
 * - broker abort awareness via InteractionHub (P0-2)
 * - cancellable plan approval (P0-3, P2-15)
 * - queued-run lifecycle: close/cancel/supersede (H-1/M-1/L-5)
 * - busy guard for conversation-rewriting commands (P1-9)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, afterEach, beforeEach } from "vitest";

import type { ProviderConfig } from "../src/config/config.js";
import type { ConversationManager } from "../src/conversation/conversation.js";
import { AgentSession, type InteractionBroker } from "../src/core/agent-session.js";
import { InteractionHub } from "../src/core/interaction-hub.js";
import type { Event } from "../src/core/schema.js";
import type { LLMClient } from "../src/llm/client.js";
import type { StreamEvent } from "../src/llm/events.js";
import type { ToolSchema } from "../src/tools/types.js";

// The session's per-run memory recall scans <home>/.larky/memory and, when
// memory files exist, issues a selector LLM call through the session client —
// the same GateClient the tests script. That extra call consumes a script slot
// and breaks the strict `started.length === 1` waits. Redirect the entire home
// directory to an empty temp dir so recall never fires. os.homedir() reads
// USERPROFILE on Windows and HOME on other platforms, so set both.
let realHome: string | undefined;
let realUserProfile: string | undefined;
beforeEach(() => {
  realHome = process.env.HOME;
  realUserProfile = process.env.USERPROFILE;
  const tmp = mkdtempSync(join(tmpdir(), "larky-home-"));
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
});
afterEach(() => {
  if (realHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = realHome;
  }
  if (realUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = realUserProfile;
  }
});

const PROVIDER: ProviderConfig = {
  name: "mock",
  protocol: "anthropic",
  base_url: "http://127.0.0.1:1",
  model: "mock-model",
  api_key: "test",
};

function abortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

const END: StreamEvent = {
  type: "stream_end",
  stopReason: "end_turn",
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
};

/**
 * LLM client for tests. Script kinds:
 * - "hang": blocks until the run's abort signal fires (abort-reactive tool);
 * - "stuck": ignores abort entirely until releaseStuck() (abort-deaf tool);
 * - StreamEvent[]: replays the given events.
 */
class GateClient implements LLMClient {
  started: (AbortSignal | undefined)[] = [];
  private stuckRejects: ((e: Error) => void)[] = [];
  constructor(private scripts: ("hang" | "stuck" | StreamEvent[])[]) {}
  setSystemPrompt(): void {
    /* noop */
  }
  releaseStuck(): void {
    for (const reject of this.stuckRejects.splice(0)) {
      reject(abortError());
    }
  }
  async *stream(
    _conv: ConversationManager,
    _tools: ToolSchema[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const idx = this.started.length;
    this.started.push(signal);
    const script = this.scripts[idx] ?? "hang";
    if (script === "hang") {
      await new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            reject(abortError());
          },
          { once: true },
        );
      });
      return;
    }
    if (script === "stuck") {
      await new Promise((_resolve, reject) => {
        this.stuckRejects.push(reject);
      });
      return;
    }
    for (const ev of script) {
      yield ev;
    }
  }
}

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

function makeSessionHarness() {
  const events: Event[] = [];
  const planPending: { signal?: AbortSignal; settled: boolean }[] = [];
  const broker: InteractionBroker = {
    requestPermission: () => Promise.resolve("allow"),
    askUser: () => Promise.resolve({}),
    requestPlanApproval: (_session, _plan, signal) =>
      new Promise((_resolve, reject) => {
        const entry = { signal, settled: false };
        planPending.push(entry);
        const fail = () => {
          entry.settled = true;
          reject(new Error("interrupted"));
        };
        if (signal?.aborted) {
          fail();
          return;
        }
        signal?.addEventListener("abort", fail, { once: true });
      }),
  };
  return { events, planPending, broker, emit: (e: Event) => events.push(e) };
}

function userMessages(session: AgentSession): string[] {
  return session.conv
    .getMessages()
    .filter((m) => m.role === "user" && !m.content.startsWith("<system-reminder>"))
    .map((m) => m.content);
}

describe("agent-session cancel & steering", () => {
  const workDirs: string[] = [];
  const sessions: AgentSession[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "larky-cancel-test-"));
    workDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const s of sessions.splice(0)) {
      try {
        await s.close();
      } catch {
        /* noop */
      }
    }
    for (const dir of workDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function createSession(
    harness: ReturnType<typeof makeSessionHarness>,
    client: GateClient,
    permissionMode?: "plan",
  ): Promise<AgentSession> {
    const session = await AgentSession.create({
      provider: PROVIDER,
      workDir: tempDir(),
      enableCoordinatorMode: false,
      forkDisabled: true,
      persist: false,
      ...(permissionMode ? { permissionMode } : {}),
      emit: harness.emit,
      broker: harness.broker,
    });
    session.client = client;
    sessions.push(session);
    return session;
  }

  it("steering does not clobber the new run's abort controller (P0-1/P0-4)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient(["hang", "hang"]);
    const session = await createSession(harness, client);

    const run1 = session.startRun("one");
    await waitFor(() => client.started.length === 1);

    const run2 = session.startRun("two");
    // Old loop must fully unwind (interrupted) before the new one starts.
    await waitFor(() =>
      harness.events.some(
        (e) =>
          e.type === "agent.loop_complete" && e.run_id === run1 && e.stop_reason === "interrupted",
      ),
    );
    await waitFor(() => client.started.length === 2);

    // Serialization: run2's user message lands after run1's loop unwound.
    expect(userMessages(session)).toEqual(["one", "two"]);

    // Regression: before the fix, run1's finally nulled run2's controller.
    expect(session.cancel()).toBe(true);
    await waitFor(() =>
      harness.events.some(
        (e) =>
          e.type === "agent.loop_complete" && e.run_id === run2 && e.stop_reason === "interrupted",
      ),
    );

    // No run2 agent event may precede run1's loop_complete.
    const idxRun1Done = harness.events.findIndex(
      (e) => e.type === "agent.loop_complete" && e.run_id === run1,
    );
    const idxRun2First = harness.events.findIndex(
      (e) => e.type.startsWith("agent.") && "run_id" in e && e.run_id === run2,
    );
    expect(idxRun2First).toBeGreaterThan(idxRun1Done);
  });

  it("close() prevents a queued (steered) run from ever starting (H-1)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient(["stuck", "hang"]);
    const session = await createSession(harness, client);

    const run1 = session.startRun("one");
    await waitFor(() => client.started.length === 1);
    // Steer: run2 queues behind the abort-deaf run1.
    session.startRun("two");

    await session.close();
    client.releaseStuck(); // run1 finally unwinds — after the session closed

    await waitFor(() =>
      harness.events.some((e) => e.type === "agent.loop_complete" && e.run_id === run1),
    );
    // Give the chain a chance to (incorrectly) start run2.
    await new Promise((r) => setTimeout(r, 50));
    expect(client.started.length).toBe(1); // run2 never reached the LLM
    expect(session.isRunning).toBe(false);
  });

  it("a run queued behind an abort-deaf tool is cancellable (M-1/L-5)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient(["stuck", "hang"]);
    const session = await createSession(harness, client);

    session.startRun("one");
    await waitFor(() => client.started.length === 1);
    const run2 = session.startRun("two");

    // Esc while run2 is still queued: aborts run2's (pre-created) controller.
    expect(session.cancel()).toBe(true);
    client.releaseStuck();

    // run2 must end with a terminal event without ever calling the LLM.
    await waitFor(() =>
      harness.events.some(
        (e) =>
          e.type === "agent.loop_complete" &&
          e.run_id === run2 &&
          e.stop_reason === "interrupted" &&
          e.total_turns === 0,
      ),
    );
    expect(client.started.length).toBe(1);
    await waitFor(() => !session.isRunning);
  });

  it("an Esc-cancelled queued run does not pollute the conversation (mid-3)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient(["stuck", "hang"]);
    const session = await createSession(harness, client);

    session.startRun("one");
    await waitFor(() => client.started.length === 1);
    const run2 = session.startRun("two");

    expect(session.cancel()).toBe(true); // withdraw the queued message
    client.releaseStuck();

    await waitFor(() =>
      harness.events.some((e) => e.type === "agent.loop_complete" && e.run_id === run2),
    );
    // The withdrawn message must not be in the conversation.
    expect(userMessages(session)).toEqual(["one"]);
  });

  it("a pre-loop failure still closes the run with a terminal event (mid-2)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient([[END]]);
    const session = await createSession(harness, client);

    // Simulate ENOSPC-class failure in the pre-loop section.
    session.conv.addUserMessage = () => {
      throw new Error("boom: disk full");
    };
    const runId = session.startRun("hello");

    await waitFor(() =>
      harness.events.some((e) => e.type === "agent.loop_complete" && e.run_id === runId),
    );
    expect(
      harness.events.some(
        (e) => e.type === "agent.error" && e.run_id === runId && e.message.includes("boom"),
      ),
    ).toBe(true);
    expect(client.started.length).toBe(0); // never reached the LLM
    await waitFor(() => !session.isRunning);
  });

  it("a superseded queued run emits a terminal loop_complete (L-5)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient(["stuck", "hang", "hang"]);
    const session = await createSession(harness, client);

    session.startRun("one");
    await waitFor(() => client.started.length === 1);
    const run2 = session.startRun("two"); // queued
    const run3 = session.startRun("three"); // supersedes run2 while queued
    client.releaseStuck();

    await waitFor(() =>
      harness.events.some(
        (e) => e.type === "agent.loop_complete" && e.run_id === run2 && e.total_turns === 0,
      ),
    );
    // run3 starts normally and is cancellable.
    await waitFor(() => client.started.length === 2);
    expect(session.cancel()).toBe(true);
    await waitFor(() =>
      harness.events.some((e) => e.type === "agent.loop_complete" && e.run_id === run3),
    );
    // Both queued-run user messages still reached the conversation in order.
    expect(userMessages(session)).toEqual(["one", "two", "three"]);
  });

  it("permission requests carry the run's live abort signal (P0-2 wiring)", async () => {
    const events: Event[] = [];
    const captured: { signal?: AbortSignal }[] = [];
    const broker: InteractionBroker = {
      requestPermission: (_s, _tool, _args, _decision, signal) =>
        new Promise((resolve) => {
          captured.push({ signal });
          if (signal?.aborted) {
            resolve("deny");
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              resolve("deny");
            },
            { once: true },
          );
        }),
      askUser: () => Promise.resolve({}),
      requestPlanApproval: () => Promise.reject(new Error("unused")),
    };
    const harness: ReturnType<typeof makeSessionHarness> = {
      events,
      planPending: [],
      broker,
      emit: (e: Event) => events.push(e),
    };
    const toolCall: StreamEvent = {
      type: "tool_call_complete",
      toolId: "tu-1",
      toolName: "WriteFile",
      arguments: { file_path: "/tmp/larky-perm-test.txt", content: "x" },
    };
    const client = new GateClient([[toolCall, END], "hang"]);
    const session = await createSession(harness, client);

    session.startRun("write something");
    await waitFor(() => captured.length === 1);
    expect(captured[0].signal).toBeDefined();
    expect(captured[0].signal?.aborted).toBe(false);

    // Esc: the pending permission must settle via the signal, unblocking the loop.
    expect(session.cancel()).toBe(true);
    expect(captured[0].signal?.aborted).toBe(true);
    await waitFor(() =>
      harness.events.some(
        (e) => e.type === "agent.loop_complete" && e.stop_reason === "interrupted",
      ),
    );
  });

  it("busy guard blocks conversation-rewriting commands while running (P1-9)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient(["hang"]);
    const session = await createSession(harness, client);

    session.startRun("go");
    await waitFor(() => client.started.length === 1);

    await session.runCommand("/compact");
    expect(
      harness.events.some(
        (e) => e.type === "system.message" && e.message.includes("not available"),
      ),
    ).toBe(true);

    // Read-only commands stay available during a run.
    harness.events.length = 0;
    await session.runCommand("/status");
    expect(
      harness.events.some((e) => e.type === "system.message" && e.message.includes("Mode:")),
    ).toBe(true);

    session.cancel();
  });

  it("/clear keeps the identity override reminder (L-4)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient([]);
    const session = await createSession(harness, client);

    const countIdentity = () =>
      session.conv.getMessages().filter((m) => m.content.includes("IDENTITY OVERRIDE")).length;
    expect(countIdentity()).toBe(1);

    await session.runCommand("/clear");
    expect(countIdentity()).toBe(1); // survived the conversation rebuild
  });

  it("cancel during plan approval settles the pending approval (P0-3)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient([[END]]);
    const session = await createSession(harness, client, "plan");

    session.startRun("make a plan");
    await waitFor(() =>
      harness.events.some((e) => e.type === "agent.loop_complete" && e.stop_reason === "end_turn"),
    );
    await waitFor(() => harness.planPending.length === 1);

    // Regression: before the fix, the controller was already nulled here.
    expect(session.cancel()).toBe(true);
    await waitFor(() => harness.planPending[0].settled);
    await waitFor(() => !session.isRunning);
  });

  it("an interrupted plan run still pops approval and stays cancellable (P2-15)", async () => {
    const harness = makeSessionHarness();
    const client = new GateClient(["hang"]);
    const session = await createSession(harness, client, "plan");

    session.startRun("plan something");
    await waitFor(() => client.started.length === 1);

    // Esc: interrupt the run
    expect(session.cancel()).toBe(true);
    await waitFor(() => harness.planPending.length === 1);

    // The approval wait got a fresh controller: still cancellable.
    expect(session.cancel()).toBe(true);
    await waitFor(() => harness.planPending[0].settled);
    await waitFor(() => !session.isRunning);
  });
});

describe("interaction hub abort awareness (P0-2)", () => {
  const DECISION = { effect: "ask", reason: "test" } as const;

  function makeHub() {
    const events: Event[] = [];
    const hub = new InteractionHub((e) => {
      events.push(e);
    });
    const sessionRef = { id: "sess-test", currentRunId: "run-test" };
    return { hub, events, sessionRef };
  }

  function findRequestedId(events: Event[]): string {
    for (const e of events) {
      if (e.type === "permission.requested") {
        return e.id;
      }
    }
    throw new Error("no permission.requested event");
  }

  it("aborting a pending permission resolves deny and clears the map", async () => {
    const { hub, events, sessionRef } = makeHub();
    const ac = new AbortController();
    const promise = hub.requestPermission(sessionRef, "Bash", {}, DECISION, ac.signal);
    await waitFor(() => hub.pendingCounts.permissions === 1);

    ac.abort();
    await expect(promise).resolves.toBe("deny");
    expect(hub.pendingCounts.permissions).toBe(0);
    await waitFor(() =>
      events.some((e) => e.type === "permission.resolved" && e.source === "abort"),
    );
    // P1-8b: the resolution mirrors the requested run_id so it is persisted
    // into the same run's replay log.
    const resolved = events.find((e) => e.type === "permission.resolved");
    expect(resolved).toMatchObject({ run_id: "run-test" });
  });

  it("aborting a pending ask rejects (isError tool_result pairing)", async () => {
    const { hub, events, sessionRef } = makeHub();
    const ac = new AbortController();
    const promise = hub.askUser(sessionRef, [], ac.signal);
    await waitFor(() => hub.pendingCounts.asks === 1);

    ac.abort();
    await expect(promise).rejects.toThrow("interrupted");
    expect(hub.pendingCounts.asks).toBe(0);
    await waitFor(() => events.some((e) => e.type === "ask_user.resolved"));
  });

  it("aborting a pending plan approval rejects and broadcasts cancelled", async () => {
    const { hub, events, sessionRef } = makeHub();
    const ac = new AbortController();
    const promise = hub.requestPlanApproval(sessionRef, "plan text", ac.signal);
    await waitFor(() => hub.pendingCounts.plans === 1);

    ac.abort();
    await expect(promise).rejects.toThrow("interrupted");
    expect(hub.pendingCounts.plans).toBe(0);
    await waitFor(() => events.some((e) => e.type === "plan.resolved" && e.choice === "cancelled"));
  });

  it("first settle wins: respond then abort settles exactly once", async () => {
    const { hub, events, sessionRef } = makeHub();
    const ac = new AbortController();
    const promise = hub.requestPermission(sessionRef, "Bash", {}, DECISION, ac.signal);
    await waitFor(() => hub.pendingCounts.permissions === 1);

    hub.respondPermission(findRequestedId(events), "allow");
    ac.abort(); // late abort must be a no-op

    await expect(promise).resolves.toBe("allow");
    const resolved = events.filter((e) => e.type === "permission.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ response: "allow", source: "client" });
  });

  it("session close settles only that session's pending (P1-8b)", async () => {
    const { hub, events, sessionRef } = makeHub();
    const other = { id: "sess-other", currentRunId: "run-o" };
    const p1 = hub.requestPermission(sessionRef, "Bash", {}, DECISION);
    const p2 = hub.requestPermission(other, "Bash", {}, DECISION);
    await waitFor(() => hub.pendingCounts.permissions === 2);

    hub.cancelForSession("sess-test");
    await expect(p1).resolves.toBe("deny");
    expect(hub.pendingCounts.permissions).toBe(1);
    expect(hub.hasPendingFor("sess-other")).toBe(true);
    const resolved = events.filter((e) => e.type === "permission.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      session_id: "sess-test",
      run_id: "run-test",
      source: "session_closed",
    });

    hub.cancelForSession("sess-other");
    await expect(p2).resolves.toBe("deny");
    expect(hub.pendingCounts.permissions).toBe(0);
  });

  it("requests raised with no connected client settle immediately (mid-1)", async () => {
    const events: Event[] = [];
    const hub = new InteractionHub(
      (e) => {
        events.push(e);
      },
      () => false, // nobody connected
    );
    const sessionRef = { id: "sess-test", currentRunId: "run-test" };

    await expect(hub.requestPermission(sessionRef, "Bash", {}, DECISION)).resolves.toBe("deny");
    await expect(hub.askUser(sessionRef, [])).rejects.toThrow("interrupted");
    await expect(hub.requestPlanApproval(sessionRef, "plan")).rejects.toThrow("interrupted");
    expect(hub.pendingCounts).toEqual({ permissions: 0, asks: 0, plans: 0 });
  });

  it("pre-aborted signal short-circuits without creating a pending entry", async () => {
    const { hub, sessionRef } = makeHub();
    const ac = new AbortController();
    ac.abort();
    await expect(hub.requestPermission(sessionRef, "Bash", {}, DECISION, ac.signal)).resolves.toBe(
      "deny",
    );
    expect(hub.pendingCounts.permissions).toBe(0);
  });
});
