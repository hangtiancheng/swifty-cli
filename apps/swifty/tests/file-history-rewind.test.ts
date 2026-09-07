import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { FileHistory } from "../src/file-history/file-history.js";

function makeTempProject(): { base: string; projectDir: string } {
  const base = mkdtempSync(join(tmpdir(), "swifty-fh-"));
  const projectDir = join(base, "project");
  mkdirSync(projectDir, { recursive: true });
  return { base, projectDir };
}

describe("FileHistory rewind", () => {
  it("deletes a file created after the target snapshot", () => {
    const { base, projectDir } = makeTempProject();
    const fh = new FileHistory(base, "session-1");

    // 第一轮：没有任何文件改动，纯对话，打一个快照。
    fh.makeSnapshot(0, "第一轮");

    // 第二轮：新建一个文件。trackEdit 在写入前调用，此时文件还不存在。
    const newFile = join(projectDir, "new-file.ts");
    fh.trackEdit(newFile);
    writeFileSync(newFile, "export const x = 1;");
    fh.makeSnapshot(2, "第二轮：新建文件");

    expect(existsSync(newFile)).toBe(true);

    // 回滚到第一轮的快照，也就是这个文件创建之前的状态。
    const changed = fh.rewind(0);

    expect(existsSync(newFile)).toBe(false);
    expect(changed).toContain(newFile);
  });

  it("restores an edit on an existing file", () => {
    const { base, projectDir } = makeTempProject();
    const fh = new FileHistory(base, "session-1");

    const existing = join(projectDir, "existing.ts");
    writeFileSync(existing, "original");

    fh.trackEdit(existing);
    fh.makeSnapshot(0, "第一轮：修改前的快照");

    writeFileSync(existing, "modified");
    fh.makeSnapshot(2, "第二轮：改了内容");

    const changed = fh.rewind(0);

    expect(readFileSync(existing, "utf-8")).toBe("original");
    expect(changed).toContain(existing);
  });

  it("keeps the created file when rewinding to its own snapshot", () => {
    const { base, projectDir } = makeTempProject();
    const fh = new FileHistory(base, "session-1");

    fh.makeSnapshot(0, "第一轮");

    const newFile = join(projectDir, "new-file.ts");
    fh.trackEdit(newFile);
    writeFileSync(newFile, "export const x = 1;");
    fh.makeSnapshot(2, "第二轮：新建文件");

    // 回滚到文件创建之后的这个快照本身，文件应该保留（内容还原成当时写入的内容）。
    fh.rewind(1);

    expect(existsSync(newFile)).toBe(true);
    expect(readFileSync(newFile, "utf-8")).toBe("export const x = 1;");
  });
});
