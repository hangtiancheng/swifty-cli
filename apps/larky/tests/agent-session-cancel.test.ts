/**
 * P0 regression tests: steering abort-controller handoff (P0-1/P0-4),
 * broker abort awareness (P0-2), and cancellable plan approval (P0-3).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, afterEach } from "vitest";

import {
  AgentSession,
  type InteractionBroker,
} from "../src/core/agent-session.js";
import { CoreApp } from "../src/core/app.js";
import type { Event } from "../src/core/bus/events.js";
import type { ProviderConfig } from "../src/config/config.js";
import type { LLMClient } from "../src/llm/client.js";
import type { StreamEvent } from "../src/llm/events.js";

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

/** LLM client whose streams hang until their run's abort signal fires. */
class GateClient implements LLMClient {
  started: (AbortSignal | undefined)[] = [];
  constructor(private scripts: ("hang" | StreamEvent[])[]) {}
  setSystemPrompt(): void {
    /* noop */
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async *stream(_conv: any, _tools: any, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const idx = this.started.length;
    this.started.push(signal);
    const script = this.scripts[idx] ?? "hang";
    if (script === "hang") {
      await new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener("abort", () => reject(abortError()), { once: true });
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
        (e) => e.type === "agent.loop_complete" && e.run_id === run1 && e.stop_reason === "interrupted",
      ),
    );
    await waitFor(() => client.started.length === 2);

    // Serialization: run2's user message lands after run1's loop unwound.
    const users = session.conv
      .getMessages()
      .filter((m) => m.role === "user" && !m.content.startsWith("<system-reminder>"))
      .map((m) => m.content);
    expect(users).toEqual(["one", "two"]);

    // Regression: before the fix, run1's finally nulled run2's controller.
    expect(session.cancel()).toBe(true);
    await waitFor(() =>
      harness.events.some(
        (e) => e.type === "agent.loop_complete" && e.run_id === run2 && e.stop_reason === "interrupted",
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
});

describe("interaction broker abort awareness (P0-2)", () => {
  type BrokerAccess = {
    _broker: InteractionBroker;
    _bus: { subscribe: (h: (e: Event) => void | Promise<void>) => void };
    _pendingPermissions: Map<string, unknown>;
    _pendingAsks: Map<string, unknown>;
    _pendingPlans: Map<string, unknown>;
  };

  function makeApp() {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const app = new CoreApp() as unknown as BrokerAccess;
    const events: Event[] = [];
    app._bus.subscribe((e) => {
      events.push(e);
    });
    const fakeSession = { id: "sess-test", currentRunId: "run-test" } as unknown as AgentSession;
    return { app, events, fakeSession };
  }

  it("aborting a pending permission resolves deny and clears the map", async () => {
    const { app, events, fakeSession } = makeApp();
    const ac = new AbortController();
    const promise = app._broker.requestPermission(
      fakeSession,
      "Bash",
      {},
      { effect: "ask", reason: "test" },
      ac.signal,
    );
    await waitFor(() => app._pendingPermissions.size === 1);

    ac.abort();
    await expect(promise).resolves.toBe("deny");
    expect(app._pendingPermissions.size).toBe(0);
    await waitFor(() =>
      events.some((e) => e.type === "permission.resolved" && e.source === "abort"),
    );
  });

  it("aborting a pending ask rejects (isError tool_result pairing)", async () => {
    const { app, events, fakeSession } = makeApp();
    const ac = new AbortController();
    const promise = app._broker.askUser(fakeSession, [], ac.signal);
    await waitFor(() => app._pendingAsks.size === 1);

    ac.abort();
    await expect(promise).rejects.toThrow("interrupted");
    expect(app._pendingAsks.size).toBe(0);
    await waitFor(() => events.some((e) => e.type === "ask_user.resolved"));
  });

  it("aborting a pending plan approval rejects and broadcasts cancelled", async () => {
    const { app, events, fakeSession } = makeApp();
    const ac = new AbortController();
    const promise = app._broker.requestPlanApproval(fakeSession, "plan text", ac.signal);
    await waitFor(() => app._pendingPlans.size === 1);

    ac.abort();
    await expect(promise).rejects.toThrow("interrupted");
    expect(app._pendingPlans.size).toBe(0);
    await waitFor(() =>
      events.some((e) => e.type === "plan.resolved" && e.choice === "cancelled"),
    );
  });

  it("first settle wins: respond then abort settles exactly once", async () => {
    const { app, events, fakeSession } = makeApp();
    const ac = new AbortController();
    const promise = app._broker.requestPermission(
      fakeSession,
      "Bash",
      {},
      { effect: "ask", reason: "test" },
      ac.signal,
    );
    await waitFor(() => app._pendingPermissions.size === 1);
    const id = [...app._pendingPermissions.keys()][0];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (app as any)._permissionRespondHandler({ id, response: "allow" });
    ac.abort(); // late abort must be a no-op

    await expect(promise).resolves.toBe("allow");
    const resolved = events.filter((e) => e.type === "permission.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ response: "allow", source: "client" });
  });

  it("pre-aborted signal short-circuits without creating a pending entry", async () => {
    const { app, fakeSession } = makeApp();
    const ac = new AbortController();
    ac.abort();
    await expect(
      app._broker.requestPermission(fakeSession, "Bash", {}, { effect: "ask", reason: "t" }, ac.signal),
    ).resolves.toBe("deny");
    expect(app._pendingPermissions.size).toBe(0);
  });
});
