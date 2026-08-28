// 来源：公众号@小林coding
// 后端八股网站：xiaolincoding.com
// Agent网站：xiaolinnote.com
// 简历模版：jianli.xiaolinnote.com

// 并发安全按这一次调用的实际参数算，不是只看工具类别。
//
// ls 和 rm 都是 Bash，前者跟 ReadFile 一样不动外部状态、可以一起并发，后者一旦跟
// 别人并发，执行顺序就不再是模型给出的那个顺序。
import { describe, it, expect } from "vitest";

import { isSafeCommand } from "../src/permissions/checker.js";
import { BashTool } from "../src/tools/bash.js";

describe("Bash 的并发安全按命令判定", () => {
  const bash = new BashTool();

  it("只读命令算安全", () => {
    for (const command of ["ls", "ls -la", "cat a.txt", "git status", "wc -l f", "pwd"]) {
      expect(bash.isConcurrencySafe({ command })).toBe(true);
    }
  });

  it("会改东西的命令不算安全", () => {
    const unsafe = [
      "rm -rf build",
      "mv a b",
      "npm install",
      "git commit -m x",
      "echo hi > f",
      "ls | wc -l",
      "ls; rm x",
      "ls && rm x",
      "echo $(rm x)",
      "ls `rm x`",
    ];
    for (const command of unsafe) {
      expect(bash.isConcurrencySafe({ command })).toBe(false);
    }
  });

  it("参数缺失或类型不对时按不安全处理", () => {
    expect(bash.isConcurrencySafe({})).toBe(false);
    expect(bash.isConcurrencySafe({ command: null })).toBe(false);
    expect(bash.isConcurrencySafe({ command: 123 })).toBe(false);
  });

  it("判定跟权限层用的是同一份白名单", () => {
    // 两边口径必须一致，否则会出现「权限放行但被当成不安全串行」这种自相矛盾
    for (const command of ["ls", "rm -rf x", "cat f", "ls | wc"]) {
      expect(bash.isConcurrencySafe({ command })).toBe(isSafeCommand(command));
    }
  });
});
