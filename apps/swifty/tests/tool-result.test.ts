import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "../src/conversation/conversation.js";
import { applyBudget } from "../src/tool-result/budget.js";

function bigToolResultConversation(size: number): Message[] {
  return [
    { role: "user", content: "do something" },
    {
      role: "assistant",
      content: "",
      toolUses: [{ toolUseId: "t1", toolName: "Bash", arguments: { command: "ls" } }],
    },
    {
      role: "user",
      content: "",
      toolResults: [{ toolUseId: "t1", content: "x".repeat(size), isError: false }],
    },
  ];
}

describe("tool result budget wiring", () => {
  it("spills a large tool result in-place", () => {
    const workDir = mkdtempSync(join(tmpdir(), "swifty-tr-"));
    const messages = bigToolResultConversation(60000);

    applyBudget(messages, workDir, "test-session");
    const result = messages[2].toolResults?.[0].content;

    // 60000-character raw output (exceeds SINGLE_RESULT_LIMIT) is replaced in-place with a spill preview
    expect(result?.length).toBeLessThan(60000);
    expect(result).toContain("Full content saved to:");
    // 替换后的内容以 persistedTagPrefix 开头
    expect(result).toMatch(/^\[Result of /);
  });

  it("is idempotent: re-applying skips already-replaced results", () => {
    const workDir = mkdtempSync(join(tmpdir(), "swifty-tr-"));
    const messages = bigToolResultConversation(60000);

    applyBudget(messages, workDir, "test-session");
    const first = messages[2].toolResults?.[0].content;
    const spillCount = readdirSync(
      join(workDir, ".swifty", "sessions", "test-session", "tool_results"),
    ).length;

    // 再次应用，已替换的内容应保持不变，不会写新的 spill 文件
    applyBudget(messages, workDir, "test-session");
    const second = messages[2].toolResults?.[0].content;
    const spillCountAfter = readdirSync(
      join(workDir, ".swifty", "sessions", "test-session", "tool_results"),
    ).length;

    expect(second).toBe(first);
    expect(spillCountAfter).toBe(spillCount);
  });

  it("leaves small tool results untouched", () => {
    const workDir = mkdtempSync(join(tmpdir(), "swifty-tr-"));
    const messages = bigToolResultConversation(100);

    applyBudget(messages, workDir, "test-session");
    // 小结果不应被修改
    expect(messages[2].toolResults?.[0].content).toBe("x".repeat(100));
  });

  it("modifies messages in-place (no new array returned)", () => {
    const workDir = mkdtempSync(join(tmpdir(), "swifty-tr-"));
    const messages = bigToolResultConversation(60000);
    const originalRef = messages[2].toolResults?.[0];

    applyBudget(messages, workDir, "test-session");

    // 同一个对象引用被修改
    expect(originalRef?.content).toContain("saved to");
    expect(messages[2].toolResults?.[0]).toBe(originalRef);
  });
});
