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

describe("instruction file loading", () => {
  it(".swifty/SWIFTY.md is ordered after SWIFTY.md in the same directory", () => {
    const dir = makeRepo("swifty-instr-");
    writeFileSync(join(dir, "SWIFTY.md"), "plain file");
    mkdirSync(join(dir, ".swifty"), { recursive: true });
    writeFileSync(join(dir, ".swifty", "SWIFTY.md"), "dotdir file");

    const out = loadInstructions(dir);
    expect(out).toContain("plain file");
    expect(out).toContain("dotdir file");
    // Later entries take higher precedence
    expect(out.indexOf("plain file")).toBeLessThan(out.indexOf("dotdir file"));
  });

  it(".swifty/SWIFTY.md participates in directory traversal with deeper dirs ordered later", () => {
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
