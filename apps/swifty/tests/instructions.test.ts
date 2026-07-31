import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadInstructions } from "../src/memory/instructions.js";

function makeRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

describe("指令文件加载", () => {
  it("同一目录下 .swifty/SWIFTY.md 排在 SWIFTY.md 之后", () => {
    const dir = makeRepo("swifty-instr-");
    writeFileSync(join(dir, "SWIFTY.md"), "plain file");
    mkdirSync(join(dir, ".swifty"), { recursive: true });
    writeFileSync(join(dir, ".swifty", "SWIFTY.md"), "dotdir file");

    const out = loadInstructions(dir);
    expect(out).toContain("plain file");
    expect(out).toContain("dotdir file");
    // 排在后面的优先级更高
    expect(out.indexOf("plain file")).toBeLessThan(out.indexOf("dotdir file"));
  });

  it(".swifty/SWIFTY.md 参与逐级遍历，深层目录排在后面", () => {
    const root = makeRepo("swifty-instr-walk-");
    const sub = join(root, "pkg", "deep");
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(root, ".swifty"), { recursive: true });
    writeFileSync(join(root, ".swifty", "SWIFTY.md"), "dotdir root");
    mkdirSync(join(sub, ".swifty"), { recursive: true });
    writeFileSync(join(sub, ".swifty", "SWIFTY.md"), "dotdir leaf");

    const out = loadInstructions(sub);
    expect(out.indexOf("dotdir root")).toBeLessThan(out.indexOf("dotdir leaf"));
  });
});
