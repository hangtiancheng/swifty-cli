// 缓存断点的落点。
//
// 该长什么样：落在最后一个非延迟工具上。一个工具同时带 defer_loading 和 cache_control
// 会被官方端点直接拒掉整个请求（400），而 MCP 工具在内建工具之后注册，数组尾部往往正是
// 延迟工具，所以不能简单地标记最后一个。
import { describe, it, expect } from "vitest";

import { markToolsForCache } from "../src/llm/anthropic.js";

import type { ToolSchema } from "@/tools/types.js";

function marked(tools: ToolSchema[]): string[] {
  return tools.filter((t) => t.cache_control !== undefined).map((t) => t.name);
}
const rest: Omit<ToolSchema, "name"> = {
  description: "",
  input_schema: {
    type: "object",
    properties: {},
  },
};
describe("缓存断点落点", () => {
  it("尾部是延迟工具时往前找", () => {
    const tools: ToolSchema[] = [
      { name: "ReadFile", ...rest },
      { name: "WriteFile", ...rest },
      { name: "ToolSearch", ...rest },
      { name: "mcp__linear__create_issue", defer_loading: true, ...rest },
      { name: "mcp__sentry__resolve", defer_loading: true, ...rest },
    ];
    markToolsForCache(tools);
    expect(marked(tools)).toEqual(["ToolSearch"]);
  });

  it("全是非延迟工具时标记最后一个", () => {
    const tools: ToolSchema[] = [
      { name: "ReadFile", ...rest },
      { name: "Bash", ...rest },
    ];
    markToolsForCache(tools);
    expect(marked(tools)).toEqual(["Bash"]);
  });

  it("延迟工具夹在中间也不会被选中", () => {
    const tools: ToolSchema[] = [
      { name: "Bash", ...rest },
      { name: "mcp__a__x", defer_loading: true, ...rest },
      { name: "Grep", ...rest },
      { name: "mcp__z__y", defer_loading: true, ...rest },
    ];
    markToolsForCache(tools);
    expect(marked(tools)).toEqual(["Grep"]);
  });

  it("全是延迟工具时一个都不标记", () => {
    // 官方要求至少有一个非延迟工具，真实注册表里内建工具永远非延迟，
    // 所以这是防御分支：宁可不缓存，也不能发出会被 400 的请求
    const tools: ToolSchema[] = [
      { name: "mcp__a__x", defer_loading: true, ...rest },
      { name: "mcp__b__y", defer_loading: true, ...rest },
    ];
    markToolsForCache(tools);
    expect(marked(tools)).toEqual([]);
  });

  it("空数组不炸", () => {
    expect(() => {
      markToolsForCache([]);
    }).not.toThrow();
  });
});
