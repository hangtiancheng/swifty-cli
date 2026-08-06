import { describe, expect, test } from "vitest";

import { needsToolSearchBeta } from "../src/llm/anthropic.js";
import {
  applyMode,
  decideMode,
  isOfficialAnthropicEndpoint,
  measureSchemaChars,
} from "../src/mcp/strategy.js";
import { buildMcpToolName, mcpToolNamePrefix } from "../src/mcp/tool-wrapper.js";
import { extractContent } from "../src/permissions/checker.js";
import { McpCallTool, coerceBySchema, mcpCallPermissionContent } from "../src/tools/mcp-call.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { ToolSearchTool } from "../src/tools/tool-search.js";
import type {
  McpLoadingMode,
  MCPToolLike,
  ToolContext,
  ToolResult,
  ToolSchema,
} from "../src/tools/types.js";

import { asRecord, strArg } from "@/utils/index.js";

const toolContext: ToolContext = { workDir: process.cwd() };

const inputSchema: ToolSchema["input_schema"] = {
  type: "object",
  properties: {
    issueId: { type: "string" },
    limit: { type: "integer" },
    ratio: { type: "number" },
    flag: { type: "boolean" },
    labels: { type: "array", items: { type: "string" } },
    ports: { type: "array", items: { type: "integer" } },
    config: {
      type: "object",
      properties: {
        replicas: { type: "integer" },
        features: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const toolSchema: ToolSchema = { name: "", description: "", input_schema: inputSchema };

/** 够用的 MCP 工具替身：暴露 schema、记录收到的参数。 */
class FakeMcpTool implements MCPToolLike {
  name: string;
  description = "fake";
  category = "command" as const;
  deferred = true;
  mcpServerName: string;
  received: Record<string, unknown> | null = null;

  constructor(
    server: string,
    tool: string,
    private schemaObj: ToolSchema["input_schema"] = {
      type: "object" as const,
      properties: {},
    },
  ) {
    this.name = buildMcpToolName(server, tool);
    this.mcpServerName = server;
  }

  mcpInputSchema(): Record<string, unknown> {
    return this.schemaObj;
  }

  setDeferLoading(on: boolean): void {
    this.deferred = on;
  }

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.schemaObj,
    };
  }

  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    this.received = args;
    return Promise.resolve({ output: "ok", isError: false });
  }
}

// 强转契约：这七条四个语言必须逐条一致
describe("coerceBySchema 契约", () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ["string ← 整数", { issueId: 8891 }, { issueId: "8891" }],
    ["string ← 小数", { issueId: 1.5 }, { issueId: "1.5" }],
    ["integer ← 数字串", { limit: "5" }, { limit: 5 }],
    ["number ← 数字串带空白", { ratio: " 1.5 " }, { ratio: 1.5 }],
    ["boolean ← true", { flag: "true" }, { flag: true }],
    ["boolean ← 大写 FALSE", { flag: "FALSE" }, { flag: false }],
    ["array ← 单键对象拆包", { labels: { item: ["a", "b"] } }, { labels: ["a", "b"] }],
    ["array ← 逗号串", { labels: "a, b" }, { labels: ["a", "b"] }],
    ["array 按 items 递归", { ports: ["8080", "9090"] }, { ports: [8080, 9090] }],
    [
      "object 按 properties 递归，嵌套层同样适用",
      { config: { replicas: "4", features: { item: ["x"] } } },
      { config: { replicas: 4, features: ["x"] } },
    ],
  ];
  for (const [desc, given, want] of cases) {
    test(desc, () => {
      expect(coerceBySchema(given, inputSchema)).toEqual(want);
    });
  }

  test("boolean 不被当成数字转成字符串", () => {
    expect(coerceBySchema({ issueId: true }, inputSchema)).toEqual({
      issueId: true,
    });
  });

  test("转不了的原样保留，交给 MCP 服务器报它自己的错", () => {
    expect(coerceBySchema({ limit: "many" }, inputSchema)).toEqual({
      limit: "many",
    });
    expect(coerceBySchema({ flag: "yes" }, inputSchema)).toEqual({
      flag: "yes",
    });
    expect(coerceBySchema({ limit: "5abc" }, inputSchema)).toEqual({
      limit: "5abc",
    });
  });

  // 各语言的字符串转数字各有各的宽松处，这几条锁住四个语言都不接受的形状
  test("integer 不截小数、不收下划线和指数", () => {
    expect(coerceBySchema({ limit: "5.7" }, inputSchema)).toEqual({
      limit: "5.7",
    });
    expect(coerceBySchema({ limit: "1_000" }, inputSchema)).toEqual({
      limit: "1_000",
    });
    expect(coerceBySchema({ limit: "1e3" }, inputSchema)).toEqual({
      limit: "1e3",
    });
    expect(coerceBySchema({ limit: "+5" }, inputSchema)).toEqual({ limit: 5 });
  });

  test("number 收指数但不收 inf / nan", () => {
    expect(coerceBySchema({ ratio: "1e3" }, inputSchema)).toEqual({
      ratio: 1000,
    });
    expect(coerceBySchema({ ratio: "inf" }, inputSchema)).toEqual({
      ratio: "inf",
    });
    expect(coerceBySchema({ ratio: "nan" }, inputSchema)).toEqual({
      ratio: "nan",
    });
  });

  test("array 收到多键对象时不猜，原样传下去", () => {
    const given = { labels: { item: "metrics", tracing: "" } };
    expect(coerceBySchema(given, inputSchema)).toEqual(given);
  });

  test("schema 里没有的键不动", () => {
    expect(coerceBySchema({ extra: 1 }, inputSchema)).toEqual({ extra: 1 });
  });

  test("已经正确的参数不动", () => {
    const good = { issueId: "X-1", limit: 3, flag: false, ports: [1, 2] };
    expect(coerceBySchema(good, inputSchema)).toEqual(good);
  });

  test("空 schema 是 no-op", () => {
    expect(coerceBySchema({ a: "1" }, {})).toEqual({ a: "1" });
  });
});

describe("mcp_call 工具名解析", () => {
  function setup() {
    const registry = new ToolRegistry();
    registry.mcpLoadingMode = "dispatch";
    const tool = new FakeMcpTool("linear", "create_issue", inputSchema);
    registry.register(tool);
    const dispatcher = new McpCallTool(registry);
    registry.register(dispatcher);
    return { registry, dispatcher, tool };
  }

  test("全名", async () => {
    const { dispatcher, tool } = setup();
    const res = await dispatcher.execute(toolContext, {
      server: "linear",
      tool: "mcp__linear__create_issue",
      arguments: { issueId: "A" },
    });
    expect(res.isError).toBe(false);
    expect(tool.received).toEqual({ issueId: "A" });
  });

  // 模型很常只传短名（实测约三成调用），必须容错，否则白白多一轮重试
  test("server + 短名", async () => {
    const { dispatcher, tool } = setup();
    const res = await dispatcher.execute(toolContext, {
      server: "linear",
      tool: "create_issue",
      arguments: { issueId: "A" },
    });
    expect(res.isError).toBe(false);
    expect(tool.received).toEqual({ issueId: "A" });
  });

  test("服务器名写错时按后缀唯一匹配兜底", async () => {
    const { dispatcher, tool } = setup();
    const res = await dispatcher.execute(toolContext, {
      server: "typo",
      tool: "create_issue",
      arguments: { issueId: "A" },
    });
    expect(res.isError).toBe(false);
    expect(tool.received).toEqual({ issueId: "A" });
  });

  test("后缀有歧义时报错并列出可用工具", async () => {
    const registry = new ToolRegistry();
    registry.register(new FakeMcpTool("linear", "create_issue"));
    registry.register(new FakeMcpTool("jira", "create_issue"));
    const dispatcher = new McpCallTool(registry);
    const res = await dispatcher.execute(toolContext, {
      server: "nope",
      tool: "create_issue",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.output).toContain("mcp__linear__create_issue");
  });

  test("转发之前先按 schema 强转", async () => {
    const { dispatcher, tool } = setup();
    await dispatcher.execute(toolContext, {
      server: "linear",
      tool: "create_issue",
      arguments: { issueId: 8891, ports: ["1"] },
    });
    expect(tool.received).toEqual({ issueId: "8891", ports: [1] });
  });
});

describe("三路分流", () => {
  test("官方端点判定", () => {
    expect(isOfficialAnthropicEndpoint("")).toBe(true);
    expect(isOfficialAnthropicEndpoint("https://api.anthropic.com")).toBe(true);
    expect(isOfficialAnthropicEndpoint("https://api.minimaxi.com/anthropic")).toBe(false);
  });

  test("schema 很小就全量上", () => {
    expect(decideMode("https://proxy.example.com", 200000, 1000)).toBe("eager");
  });

  test("没有 MCP 工具也全量上", () => {
    expect(decideMode("https://proxy.example.com", 200000, 0)).toBe("eager");
  });

  test("官方端点走原生延迟", () => {
    expect(decideMode("", 200000, 500000)).toBe("native");
  });

  test("第三方端点走 mcp_call", () => {
    expect(decideMode("https://api.minimaxi.com/anthropic", 200000, 500000)).toBe("dispatch");
  });

  test("只统计 MCP 工具的 schema 体量", () => {
    const registry = new ToolRegistry();
    expect(measureSchemaChars(registry)).toBe(0);
    registry.register(new FakeMcpTool("linear", "create_issue", inputSchema));
    expect(measureSchemaChars(registry)).toBeGreaterThan(0);
  });
});

describe("applyMode 对 tools[] 的影响", () => {
  function mcpSchemas(registry: ToolRegistry) {
    return registry.getAllSchemas("anthropic").filter((s) => s.name.startsWith("mcp__"));
  }

  test("eager: 进数组且不带 defer_loading", () => {
    const registry = new ToolRegistry();
    registry.register(new FakeMcpTool("linear", "create_issue", inputSchema));
    applyMode(registry, "eager");
    const mcp = mcpSchemas(registry);
    expect(mcp).toHaveLength(1);
    expect(mcp[0].defer_loading).toBeUndefined();
  });

  test("native：进数组且带 defer_loading", () => {
    const registry = new ToolRegistry();
    registry.register(new FakeMcpTool("linear", "create_issue", inputSchema));
    applyMode(registry, "native");
    const mcp = mcpSchemas(registry);
    expect(mcp).toHaveLength(1);
    expect(mcp[0].defer_loading).toBe(true);
  });

  test("dispatch：完全不进数组", () => {
    const registry = new ToolRegistry();
    registry.register(new FakeMcpTool("linear", "create_issue", inputSchema));
    applyMode(registry, "dispatch");
    expect(mcpSchemas(registry)).toHaveLength(0);
  });

  test("openai 协议下不带出 defer_loading", () => {
    // defer_loading 是 Anthropic 的字段
    const registry = new ToolRegistry();
    registry.register(new FakeMcpTool("linear", "create_issue", inputSchema));
    applyMode(registry, "native");
    const names = registry.getAllSchemas("openai").map((s) => {
      const fn: unknown = Reflect.get(s, "function");
      return strArg(asRecord(fn), "name");
    });
    expect(names.some((n) => n.startsWith("mcp__"))).toBe(false);
  });
});

describe("权限 content 归一化", () => {
  const cases: [string, string, string][] = [
    ["linear", "mcp__linear__create_issue", "linear__create_issue"],
    ["linear", "create_issue", "linear__create_issue"],
    ["chrome-2", "mcp__chrome_2__click", "chrome_2__click"],
    // 短名和全名必须算出同一个 content，否则规则会漏匹配
    ["chrome-devtools", "click", "chrome_devtools__click"],
    ["chrome-devtools", "mcp__chrome_devtools__click", "chrome_devtools__click"],
  ];
  for (const [server, tool, want] of cases) {
    test(`${server} + ${tool}`, () => {
      expect(mcpCallPermissionContent(server, tool)).toBe(want);
    });
  }

  test("extractContent 把 mcp_call 路由到归一化逻辑", () => {
    expect(
      extractContent("McpCall", {
        server: "linear",
        tool: "mcp__linear__create_issue",
      }),
    ).toBe("linear__create_issue");
  });

  test("其他工具的 content 抽取不变", () => {
    expect(extractContent("Bash", { command: "ls" })).toBe("ls");
    expect(extractContent("mcp__linear__create_issue", { title: "x" })).toBe("");
  });
});

// beta header 的开关条件：只有工具真带了 defer_loading 才发。
//
// 官方端点这条路没法拿第三方端点真机验证，这里只能盯住请求该长什么样：header
// 漏了，defer_loading 会被服务端直接拒；header 多发了，不认识它的端点也会拒。
describe("原生延迟的 beta header", () => {
  test("没有工具", () => {
    expect(needsToolSearchBeta([])).toBe(false);
  });

  test("工具都不延迟", () => {
    expect(
      needsToolSearchBeta([
        { ...toolSchema, name: "Bash" },
        { ...toolSchema, name: "ToolSearch" },
      ]),
    ).toBe(false);
  });

  test("有一个带 defer_loading", () => {
    expect(
      needsToolSearchBeta([
        { ...toolSchema, name: "Bash" },
        { ...toolSchema, name: "mcp__linear__x", defer_loading: true },
      ]),
    ).toBe(true);
  });

  test("defer_loading 是 false 不算", () => {
    expect(needsToolSearchBeta([{ ...toolSchema, name: "x", defer_loading: false }])).toBe(false);
  });
});

describe("工具命名", () => {
  test("双下划线分隔", () => {
    expect(buildMcpToolName("linear", "create_issue")).toBe("mcp__linear__create_issue");
  });

  test("横杠和点都换成下划线，与 Go/Python 一致", () => {
    expect(buildMcpToolName("chrome-devtools", "take.snapshot")).toBe(
      "mcp__chrome_devtools__take_snapshot",
    );
  });

  test("前缀助手与拼出来的名字对得上", () => {
    expect(buildMcpToolName("chrome-2", "click").startsWith(mcpToolNamePrefix("chrome-2"))).toBe(
      true,
    );
  });
});

// 检索和分发只在用得上的模式里发给模型。eager 下 MCP 工具全在 tools[] 里，
// 既没有可搜的对象也不需要分发入口，两个都发过去只是白占 token。
describe("按模式决定发哪些工具", () => {
  function names(mode: McpLoadingMode): string[] {
    const registry = new ToolRegistry();
    registry.register(new ToolSearchTool(registry));
    registry.register(new McpCallTool(registry));
    registry.register(new FakeMcpTool("linear", "create_issue", inputSchema));
    applyMode(registry, mode);
    return registry
      .getAllSchemas("anthropic")
      .map((s) => s.name)
      .sort();
  }

  test("eager：两个都不发", () => {
    expect(names("eager")).toEqual(["mcp__linear__create_issue"]);
  });

  test("native：只发 ToolSearch", () => {
    expect(names("native")).toEqual(["ToolSearch", "mcp__linear__create_issue"]);
  });

  test("dispatch：两个都发，MCP 工具不发", () => {
    expect(names("dispatch")).toEqual(["McpCall", "ToolSearch"]);
  });

  test("没连 MCP 时两个都不发", () => {
    // applyMode 不会被调用，开关保持默认关闭
    const registry = new ToolRegistry();
    registry.register(new ToolSearchTool(registry));
    registry.register(new McpCallTool(registry));
    expect(registry.getAllSchemas("anthropic")).toHaveLength(0);
  });
});
