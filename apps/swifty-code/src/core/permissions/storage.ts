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

// policy.toml persistence: load and save [always] section
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";

const DEFAULT_POLICY_PATH = path.join(homedir(), ".swifty-code", "policy.toml");

// Load [always] section from policy.toml; returns {tool_name: "allow"/"deny"}; empty dict if file missing
export function loadPolicyFile(filePath?: string): Record<string, string> {
  const p = filePath ?? DEFAULT_POLICY_PATH;
  if (!existsSync(p)) return {};

  const result: Record<string, string> = {};
  let inAlways = false;

  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const stripped = line.trim();
    if (stripped === "[always]") {
      inAlways = true;
      continue;
    }
    if (stripped.startsWith("[")) {
      inAlways = false;
      continue;
    }
    if (inAlways && stripped.includes("=") && !stripped.startsWith("#")) {
      const eqIdx = stripped.indexOf("=");
      const k = stripped.slice(0, eqIdx).trim();
      let v = stripped.slice(eqIdx + 1).trim();
      // Strip quotes
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (v === "allow" || v === "deny") {
        // B-9: tool names are matched case-insensitively; normalize keys read
        // from disk so pre-existing mixed-case entries still hit the cache
        result[k.toLowerCase()] = v;
      }
    }
  }
  return result;
}

// Write {tool_name: "allow"/"deny"} to policy.toml, overwriting [always] section
export function savePolicyFile(
  always: Record<string, string>,
  filePath?: string,
): void {
  const p = filePath ?? DEFAULT_POLICY_PATH;
  mkdirSync(path.dirname(p), { recursive: true });

  const lines = [
    "# ~/.swifty-code/policy.toml",
    "# Managed by swifty-core; manual edits are preserved if format is correct",
    "",
    "[always]",
  ];
  // B-9: normalize tool names to lowercase (defensive; registered tools are
  // already all-lowercase). Sort after normalization for stable output.
  const normalized: Record<string, string> = {};
  for (const [tool, val] of Object.entries(always)) {
    normalized[tool.toLowerCase()] = val;
  }
  for (const tool of Object.keys(normalized).sort()) {
    const val = normalized[tool] ?? "";
    lines.push(`${tool} = "${val}"`);
  }
  // B-8: atomic write — write a temp file in the same directory then rename
  // over the target, so a mid-write crash never truncates policy.toml
  const tmp = `${p}.${String(process.pid)}-${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, lines.join("\n") + "\n", "utf-8");
  renameSync(tmp, p);
}
