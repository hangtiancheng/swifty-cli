// 延迟工具清单提醒的注入时机，跑的是真实主循环。
//
// 这条提醒是 push 进历史的，发一次就一直在上下文里，所以每轮重发只是拿相同内容占
// 窗口，六十来个 MCP 工具一份清单五百多 token，四十轮下来两万多。
//
// 该长什么样：一场多轮的工具调用里只出现一次；池子变了补一次；历史被压掉之后重新发。
import { describe, it, expect } from "vitest";

import { Agent } from "../src/agent/agent.js";
import { ConversationManager } from "../src/conversation/conversation.js";
import type { LLMClient } from "../src/llm/client.js";
import type { StreamEvent, UsageInfo } from "../src/llm/events.js";
import { PermissionChecker } from "../src/permissions/checker.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { Tool } from "../src/tools/types.js";

import { contentToText } from "@/utils/index.js";

const MARKER = "The following deferred tools are available via ToolSearch.";
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

const noopTool: Tool = {
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

function deferredStub(name: string): Tool {
  return {
    name,
    description: name,
    category: "read",
    deferred: true,
    schema: () => ({ name, description: "", input_schema: { type: "object", properties: {} } }),
    execute: () => Promise.resolve({ output: "ok", isError: false }),
  };
}

// 一轮工具调用的脚本
const toolTurn = (id: string): StreamEvent[] => [
  { type: "tool_call_start", toolName: "Echo", toolId: id },
  { type: "tool_call_complete", toolId: id, toolName: "Echo", arguments: {} },
  end("tool_use"),
];

function makeAgent(client: LLMClient, registry: ToolRegistry, conv: ConversationManager): Agent {
  return new Agent({
    client,
    registry,
    checker: new PermissionChecker(process.cwd(), "bypassPermissions"),
    conversation: conv,
    workDir: process.cwd(),
  });
}

function count(conv: ConversationManager): number {
  return conv
    .getMessages()
    .filter((m) => m.role === "user" && contentToText(m.content).includes(MARKER)).length;
}

async function drain(agent: Agent): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of agent.run()) {
    // 只关心副作用落在 conversation 上
  }
}

describe("延迟工具清单提醒", () => {
  it("四个轮次里只注入一次", async () => {
    // 三轮工具调用 + 一轮收尾，主循环一共转四次
    const client = new MockClient([
      toolTurn("t1"),
      toolTurn("t2"),
      toolTurn("t3"),
      [{ type: "text_delta", text: "done" }, end()],
    ]);
    const registry = new ToolRegistry();
    registry.register(noopTool);
    registry.register(deferredStub("mcp__linear__create_issue"));
    registry.register(deferredStub("mcp__sentry__resolve_issue"));

    const conv = new ConversationManager();
    conv.addUserMessage("do three things");
    await drain(makeAgent(client, registry, conv));

    expect(client.calls).toBe(4);
    expect(count(conv)).toBe(1);
  });

  it("工具池变了补一次", async () => {
    const registry = new ToolRegistry();
    registry.register(deferredStub("mcp__linear__create_issue"));
    const conv = new ConversationManager();

    const c1 = new MockClient([[{ type: "text_delta", text: "one" }, end()]]);
    conv.addUserMessage("第一个回合");
    await drain(makeAgent(c1, registry, conv));
    expect(count(conv)).toBe(1);

    // MCP 服务器姗姗来迟，池子多出一个工具
    registry.register(deferredStub("mcp__infra__scale_service"));
    const c2 = new MockClient([[{ type: "text_delta", text: "two" }, end()]]);
    conv.addUserMessage("第二个回合");
    await drain(makeAgent(c2, registry, conv));
    expect(count(conv)).toBe(2);
  });

  it("历史被压掉之后重新宣告", async () => {
    const registry = new ToolRegistry();
    registry.register(deferredStub("mcp__linear__create_issue"));
    const conv = new ConversationManager();

    const c1 = new MockClient([[{ type: "text_delta", text: "one" }, end()]]);
    conv.addUserMessage("第一个回合");
    await drain(makeAgent(c1, registry, conv));
    expect(count(conv)).toBe(1);

    // 模拟 compact：历史被压成一条摘要，那条提醒随之消失
    conv.truncateTo(0);
    conv.addUserMessage("summary of earlier conversation");

    const c2 = new MockClient([[{ type: "text_delta", text: "two" }, end()]]);
    await drain(makeAgent(c2, registry, conv));
    expect(count(conv)).toBe(1);
  });

  it("延迟工具名按字典序返回，顺序稳定", () => {
    const registry = new ToolRegistry();
    for (const n of ["mcp__z__b", "mcp__a__c", "mcp__m__a"]) {
      registry.register(deferredStub(n));
    }
    const want = ["mcp__a__c", "mcp__m__a", "mcp__z__b"];
    expect(registry.getDeferredToolNames()).toEqual(want);
    expect(registry.getDeferredToolNames()).toEqual(want);
  });

  it("没有延迟工具时完全不注入", async () => {
    const client = new MockClient([[{ type: "text_delta", text: "hi" }, end()]]);
    const conv = new ConversationManager();
    conv.addUserMessage("hi");
    await drain(makeAgent(client, new ToolRegistry(), conv));
    expect(count(conv)).toBe(0);
  });
});
