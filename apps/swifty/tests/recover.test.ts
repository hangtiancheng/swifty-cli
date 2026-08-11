import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, afterEach } from "vitest";

import { record, recordError, recordExit } from "../src/recover.js";

// 崩溃日志固定写在当前工作目录下，用例切进临时目录再切回来
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("crash log", () => {
  it("appends records with a timestamp", () => {
    const dir = mkdtempSync(join(tmpdir(), "swifty-crash-"));
    process.chdir(dir);

    record("start pid=1");
    try {
      throw new Error("boom");
    } catch (err) {
      recordError("uncaughtException", err);
    }

    const log = readFileSync(join(dir, ".swifty", "crash.log"), "utf8");
    expect(log).toContain("start pid=1");
    expect(log).toContain("crash [uncaughtException] Error: boom");
    expect(log).toContain("crashlog.test.ts");
    // 追加写：后一条不能把前一条冲掉
    expect(log.indexOf("start pid=1")).toBeLessThan(log.indexOf("crash ["));

    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  // 幂等标志是模块级的，整个文件里只有这一处调用 recordExit
  it("writes the exit marker only once", () => {
    const dir = mkdtempSync(join(tmpdir(), "swifty-crash-"));
    process.chdir(dir);

    recordExit(0);
    recordExit(1);

    const log = readFileSync(join(dir, ".swifty", "crash.log"), "utf8");
    const marks = log.split("\n").filter((line) => line.includes("exit pid="));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toContain("code=0");

    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("records non-Error rejection values", () => {
    const dir = mkdtempSync(join(tmpdir(), "swifty-crash-"));
    process.chdir(dir);

    recordError("unhandledRejection", "plain string reason");

    const log = readFileSync(join(dir, ".swifty", "crash.log"), "utf8");
    expect(log).toContain("crash [unhandledRejection] plain string reason");

    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });
});
