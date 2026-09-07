import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ChatMessage } from "../src/tui/chat.js";
import {
  ERASE_SCROLLBACK,
  ERASE_VIEWPORT,
  TranscriptQueue,
  type TranscriptRenderers,
} from "../src/tui/transcript-writer.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = join(pkgRoot, "node_modules", ".bin", "tsx");
const fixture = join(pkgRoot, "tests", "fixtures", "transcript-queue-child.tsx");

const stubRenderers: TranscriptRenderers = {
  message: (message) => `msg:${message.content}\n`,
  brand: (model) => `brand:${model}\n`,
};

function message(content: string): ChatMessage {
  return { role: "assistant", content };
}

interface Harness {
  writes: string[];
  errors: unknown[];
  queue: TranscriptQueue;
  run: () => void;
  pendingTasks: () => number;
}

function harness(renderers: TranscriptRenderers = stubRenderers): Harness {
  const writes: string[] = [];
  const errors: unknown[] = [];
  let tasks: (() => void)[] = [];
  const queue = new TranscriptQueue({
    write: (data) => writes.push(data),
    columns: () => 80,
    renderers,
    schedule: (task) => {
      tasks.push(task);
      return {
        cancel: () => {
          tasks = tasks.filter((pending) => pending !== task);
        },
      };
    },
    onError: (err) => errors.push(err),
  });

  return {
    writes,
    errors,
    queue,
    run: () => {
      const scheduled = tasks;
      tasks = [];
      for (const task of scheduled) {
        task();
      }
    },
    pendingTasks: () => tasks.length,
  };
}

describe("TranscriptQueue", () => {
  it("defers every render past the current execution context", () => {
    const h = harness();

    h.queue.enqueueBrand("model-a", "/work");
    h.queue.enqueueMessages([message("one")], false);

    expect(h.writes).toEqual([]);
    expect(h.queue.size()).toBe(2);

    h.run();

    expect(h.writes).toEqual(["brand:model-a\n", "msg:one\n"]);
    expect(h.queue.size()).toBe(0);
  });

  it("preserves FIFO order across mixed enqueues", () => {
    const h = harness();

    h.queue.enqueueMessages([message("one"), message("two")], false);
    h.queue.enqueueBrand("model-b", "/work");
    h.queue.enqueueMessages([message("three")], false);
    h.run();

    expect(h.writes).toEqual(["msg:one\n", "msg:two\n", "brand:model-b\n", "msg:three\n"]);
  });

  it("drops pending output when the screen is erased", () => {
    const h = harness();

    h.queue.enqueueMessages([message("stale-one"), message("stale-two")], false);
    h.queue.enqueueClear({ scrollback: true });
    h.queue.enqueueBrand("model-c", "/work");
    h.run();

    expect(h.writes).toEqual([ERASE_SCROLLBACK, "brand:model-c\n"]);
  });

  it("replays the bounded tail exactly once after a single erase", () => {
    const h = harness();

    h.queue.enqueueMessages([message("pending")], false);
    h.queue.enqueueReplay([message("kept-one"), message("kept-two")], true);
    h.run();

    expect(h.writes).toEqual([ERASE_VIEWPORT, "msg:kept-one\n", "msg:kept-two\n"]);
  });

  it("stops writing after cancel and clears scheduled work", () => {
    const h = harness();

    h.queue.enqueueMessages([message("dropped")], false);
    h.queue.cancel();

    expect(h.queue.size()).toBe(0);
    expect(h.pendingTasks()).toBe(0);

    h.queue.enqueueMessages([message("also-dropped")], false);
    h.run();

    expect(h.writes).toEqual([]);
  });

  it("reports render failures and keeps draining", () => {
    const h = harness({
      brand: () => {
        throw new Error("brand render failed");
      },
      message: (msg) => `msg:${msg.content}\n`,
    });

    h.queue.enqueueBrand("model-d", "/work");
    h.queue.enqueueMessages([message("after-error")], false);
    h.run();

    expect(h.errors).toHaveLength(1);
    expect(h.writes).toEqual(["msg:after-error\n"]);
  });
});

describe("renderToString containment", () => {
  it("is only called from the transcript writer", () => {
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || full.endsWith("transcript-writer.tsx")) {
          continue;
        }
        if (readFileSync(full, "utf-8").includes("renderToString")) {
          offenders.push(full);
        }
      }
    };
    scan(join(pkgRoot, "src"));

    expect(offenders).toEqual([]);
  });
});

const ResultSchema = z.object({ order: z.array(z.string()) });

function runFixture(scenario: string) {
  const result = spawnSync(tsxBin, [fixture, scenario], {
    cwd: pkgRoot,
    encoding: "utf-8",
    timeout: 60_000,
  });
  const marker = /##RESULT##(.+)/.exec(result.stderr);
  return {
    status: result.status,
    stderr: result.stderr,
    order: marker ? ResultSchema.parse(JSON.parse(marker[1])).order : [],
  };
}

describe.skipIf(!existsSync(tsxBin))("live Ink root integration", () => {
  it("writes brand and messages enqueued from an effect without crashing Yoga", () => {
    const run = runFixture("effect-enqueue");

    expect(run.stderr).not.toMatch(/table index is out of bounds/);
    expect(run.status).toBe(0);
    expect(run.order.indexOf("effect-end")).toBeLessThan(run.order.indexOf("brand"));
    expect(run.order.filter((entry) => entry === "brand")).toHaveLength(1);
    expect(run.order.filter((entry) => entry === "marker-one")).toHaveLength(1);
    expect(run.order).toEqual(["effect-end", "brand", "marker-one", "marker-two", "unmount"]);
  });

  it("erases once and replays the tail when a replay follows pending writes", () => {
    const run = runFixture("clear-replay");

    expect(run.stderr).not.toMatch(/table index is out of bounds/);
    expect(run.status).toBe(0);
    expect(run.order.filter((entry) => entry === "erase")).toHaveLength(1);
    expect(run.order).toEqual(["effect-end", "erase", "marker-one", "marker-two", "unmount"]);
  });

  it("produces no output after unmount", () => {
    const run = runFixture("unmount-cancel");

    expect(run.stderr).not.toMatch(/table index is out of bounds/);
    expect(run.status).toBe(0);
    expect(run.order.at(-1)).toBe("unmount");
    expect(run.order).not.toContain("marker-after-unmount");
  });
});
