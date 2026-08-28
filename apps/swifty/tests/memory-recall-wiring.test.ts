// 来源：公众号@小林coding
// 后端八股网站：xiaolincoding.com
// Agent网站：xiaolinnote.com
// 简历模版：jianli.xiaolinnote.com

import { describe, it, expect } from "vitest";

import { Agent } from "../src/agent/agent.js";
import { ConversationManager } from "../src/conversation/conversation.js";
import type { LLMClient } from "../src/llm/client.js";
import type { StreamEvent, UsageInfo } from "../src/llm/events.js";
import type { RecallResult } from "../src/memory/manager.js";
import { PermissionChecker } from "../src/permissions/checker.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { Tool } from "../src/tools/types.js";

const USAGE: UsageInfo = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};
const end = (reason = "end_turn"): StreamEvent => ({
  type: "stream_end",
  stopReason: reason,
  usage: USAGE,
});

const REMINDER = "## Memory: a.md";

class MockClient implements LLMClient {
  calls = 0;
  constructor(private scripts: StreamEvent[][]) {}
  setSystemPrompt() {
    /** noop */
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(): AsyncGenerator<StreamEvent> {
    const script = this.scripts[this.calls++] ?? [end()];
    for (const ev of script) {
      yield ev;
    }
  }
  setMaxOutputTokens(): void {
    /** noop */
  }
}

const echoTool: Tool = {
  name: "Echo",
  description: "echo",
  category: "read",
  schema: () => ({
    name: "Echo",
    description: "echo",
    input_schema: { type: "object", properties: {} },
  }),
  execute: () => Promise.resolve({ output: "echoed", isError: false }),
};

/** 造一个已经完成的召回 promise，模拟 prefetch 在主调用期间已经跑完。 */
function settledRecall(): Promise<RecallResult> {
  return Promise.resolve({ reminder: REMINDER, paths: ["/mem/a.md"] });
}

async function run(scripts: StreamEvent[][], withTool: boolean) {
  const conv = new ConversationManager();
  conv.addUserMessage("hi");
  const registry = new ToolRegistry();
  if (withTool) {
    registry.register(echoTool);
  }
  const surfaced: string[] = [];
  const agent = new Agent({
    client: new MockClient(scripts),
    registry,
    checker: new PermissionChecker(process.cwd(), "bypassPermissions"),
    conversation: conv,
    workDir: process.cwd(),
    memoryRecallPromise: settledRecall(),
    onMemoriesSurfaced: (paths) => surfaced.push(...paths),
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of agent.run()) {
    // drain
  }
  const injected = conv.getMessages().some((m) => m.content.includes(REMINDER));
  return { injected, surfaced };
}

describe("memory recall wiring", () => {
  it("有工具调用的一轮：召回结果在工具结果之后注入，同时记为已注入", async () => {
    const { injected, surfaced } = await run(
      [
        [
          { type: "tool_call_complete", toolId: "t1", toolName: "Echo", arguments: {} },
          end("tool_use"),
        ],
        [{ type: "text_delta", text: "done" }, end()],
      ],
      true,
    );
    expect(injected).toBe(true);
    expect(surfaced).toEqual(["/mem/a.md"]);
  });

  it("没有工具调用的一轮：召回结果没被消费，对应记忆不能记为已注入", async () => {
    const { injected, surfaced } = await run(
      [[{ type: "text_delta", text: "plain" }, end()]],
      false,
    );
    expect(injected).toBe(false);
    expect(surfaced).toEqual([]);
  });
});
