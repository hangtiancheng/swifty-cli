/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PermissionChecker } from "../src/permissions/checker.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "swifty-test-"));
}

function makeChecker(tmpDir: string, rules: { rule: string; effect: string }[]) {
  const rulesDir = join(tmpDir, ".swifty");
  mkdirSync(rulesDir, { recursive: true });
  const rulesFile = join(rulesDir, "permissions.yaml");
  const yaml = rules.map((r) => `- rule: "${r.rule}"\n  effect: ${r.effect}`).join("\n");
  writeFileSync(rulesFile, yaml);

  const checker = new PermissionChecker(tmpDir, "default");
  checker.sandboxEnabled = true;
  checker.sandboxAutoAllow = true;
  return checker;
}

describe("sandbox auto-allow respects deny/ask rules", () => {
  it("denies compound command with denied subcommand", () => {
    const dir = makeTmpDir();
    const checker = makeChecker(dir, [{ rule: "Bash(rm -rf /)", effect: "deny" }]);
    const result = checker.check("Bash", "command", {
      command: "echo ok && rm -rf /",
    });
    expect(result.effect).toBe("deny");
  });

  it("allows safe command with sandbox", () => {
    const dir = makeTmpDir();
    const checker = makeChecker(dir, [{ rule: "Bash(rm -rf /)", effect: "deny" }]);
    const result = checker.check("Bash", "command", {
      command: "go test ./...",
    });
    expect(result.effect).toBe("allow");
  });

  it("respects ask rule even with sandbox", () => {
    const dir = makeTmpDir();
    const checker = makeChecker(dir, [{ rule: "Bash(git push origin main)", effect: "ask" }]);
    const result = checker.check("Bash", "command", {
      command: "git push origin main",
    });
    expect(result.effect).toBe("ask");
  });
});
