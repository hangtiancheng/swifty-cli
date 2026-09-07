import { render, Text } from "ink";
import React, { useEffect } from "react";

import { TranscriptQueue } from "../../src/tui/transcript-writer.js";

// Runs in a dedicated child process: the crash this guards against escapes
// asynchronously and would tear down the Vitest worker.

const scenario = process.argv[2] ?? "";
const order: string[] = [];

function tag(data: string): string {
  if (data.includes("\x1b[2J")) {
    return "erase";
  }
  if (data.includes("Swifty v")) {
    return "brand";
  }
  const match = /marker-[a-z0-9-]+/.exec(data);
  return match ? match[0] : "other";
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      setImmediate(() => {
        setTimeout(resolve, 30);
      });
    });
  });
}

async function main(): Promise<void> {
  const messages = [
    { role: "assistant" as const, content: "marker-one" },
    { role: "assistant" as const, content: "marker-two" },
  ];

  const holder: { queue: TranscriptQueue | null } = { queue: null };

  function Harness(): React.ReactNode {
    useEffect(() => {
      const active = new TranscriptQueue({
        write: (data) => {
          order.push(tag(data));
          process.stdout.write(data);
        },
        columns: () => 80,
        onError: (err) => {
          order.push(`error:${String(err)}`);
        },
      });
      holder.queue = active;

      active.enqueueBrand("test-model", "/tmp/work");
      if (scenario === "clear-replay") {
        active.enqueueMessages(messages, false);
        active.enqueueReplay(messages, false);
      } else {
        active.enqueueMessages(messages, false);
      }
      order.push("effect-end");

      return () => {
        active.cancel();
      };
    }, []);

    return React.createElement(Text, null, "live-root");
  }

  const instance = render(React.createElement(Harness), {
    stdout: process.stdout,
    interactive: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });

  await tick();

  order.push("unmount");
  instance.unmount();
  await instance.waitUntilExit();

  if (scenario === "unmount-cancel") {
    holder.queue?.enqueueMessages([{ role: "assistant", content: "marker-after-unmount" }], false);
  }

  await tick();

  process.stdout.write("\n");
  const result = JSON.stringify({ order });
  process.stderr.write(`##RESULT##${result}\n`);
}

const watchdog = setTimeout(() => {
  process.stderr.write('##RESULT##{"order":["timeout"]}\n');
  process.exit(2);
}, 20_000);
watchdog.unref();

main().then(
  () => {
    process.exit(0);
  },
  (err: unknown) => {
    process.stderr.write(`fixture failed: ${String(err)}\n`);
    process.exit(1);
  },
);
