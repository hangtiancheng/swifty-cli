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

// TUI component tests: InputBox multi-line paste + code-point-safe editing,
// PermissionDialog single-key shortcuts.
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";

import { InputBox } from "../src/tui/input.js";
import { PermissionDialog, type PermissionAction } from "../src/tui/permission-dialog.js";

function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("InputBox", () => {
  it("inserts pasted multi-line text as multiple lines instead of stripping newlines", async () => {
    const submitted: string[] = [];
    const { stdin, lastFrame } = render(
      <InputBox
        onSubmit={(t) => {
          submitted.push(t);
        }}
      />,
    );
    await tick();

    // Paste arrives as one multi-character input chunk containing newlines
    stdin.write("first line\nsecond line");
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("first line");
    expect(frame).toContain("second line");
    // Nothing submitted yet: paste must not auto-submit
    expect(submitted).toEqual([]);

    // Plain Enter submits the multi-line value with newlines preserved
    stdin.write("\r");
    await tick();
    expect(submitted).toEqual(["first line\nsecond line"]);
  });

  it("normalizes CRLF/CR in pasted text into line breaks", async () => {
    const submitted: string[] = [];
    const { stdin } = render(
      <InputBox
        onSubmit={(t) => {
          submitted.push(t);
        }}
      />,
    );
    await tick();

    stdin.write("alpha\r\nbeta\rgamma");
    await tick();
    stdin.write("\r");
    await tick();
    expect(submitted).toEqual(["alpha\nbeta\ngamma"]);
  });

  it("backspace deletes a whole emoji (surrogate pair) instead of splitting it", async () => {
    const submitted: string[] = [];
    const { stdin, lastFrame } = render(
      <InputBox
        onSubmit={(t) => {
          submitted.push(t);
        }}
      />,
    );
    await tick();

    stdin.write("a😀");
    await tick();
    // Backspace (DEL)
    stdin.write("\u007F");
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("😀");
    // No lone surrogate garbage
    expect(frame).not.toContain("\uFFFD");

    stdin.write("\r");
    await tick();
    expect(submitted).toEqual(["a"]);
  });

  it("left arrow moves across a full emoji code point", async () => {
    const submitted: string[] = [];
    const { stdin } = render(
      <InputBox
        onSubmit={(t) => {
          submitted.push(t);
        }}
      />,
    );
    await tick();

    stdin.write("😀b");
    await tick();
    // Move left over "b", then over the emoji, then insert "x" at the start
    stdin.write("\u001B[D");
    await tick();
    stdin.write("\u001B[D");
    await tick();
    stdin.write("x");
    await tick();
    stdin.write("\r");
    await tick();
    expect(submitted).toEqual(["x😀b"]);
  });
});

describe("PermissionDialog", () => {
  function setup(): {
    results: PermissionAction[];
    stdin: { write: (data: string) => void };
    lastFrame: () => string | undefined;
  } {
    const results: PermissionAction[] = [];
    const { stdin, lastFrame } = render(
      <PermissionDialog
        toolName="bash"
        argsSummary="ls -la"
        onComplete={(a) => {
          results.push(a);
        }}
      />,
    );
    return { results, stdin, lastFrame };
  }

  it("shows shortcut annotations in the option labels", async () => {
    const { lastFrame } = setup();
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[y]");
    expect(frame).toContain("[a]");
    expect(frame).toContain("[n]");
    expect(frame).toContain("[d]");
  });

  it.each([
    ["y", "allow_once"],
    ["a", "always_allow"],
    ["n", "deny_once"],
    ["d", "always_deny"],
  ] as const)("shortcut '%s' resolves to %s", async (keyChar, action) => {
    const { results, stdin } = setup();
    await tick();
    stdin.write(keyChar);
    await tick();
    expect(results).toEqual([action]);
  });

  it.each([
    ["1", "allow_once"],
    ["2", "always_allow"],
    ["3", "deny_once"],
    ["4", "always_deny"],
  ] as const)("digit '%s' resolves to %s", async (digit, action) => {
    const { results, stdin } = setup();
    await tick();
    stdin.write(digit);
    await tick();
    expect(results).toEqual([action]);
  });

  it("arrow keys + enter still select an option", async () => {
    const { results, stdin } = setup();
    await tick();
    // Down to option 2 (always_allow), then Enter
    stdin.write("\u001B[B");
    await tick();
    stdin.write("\r");
    await tick();
    expect(results).toEqual(["always_allow"]);
  });

  it("escape keeps the deny_once behavior", async () => {
    const { results, stdin } = setup();
    await tick();
    stdin.write("\u001B");
    await tick(150);
    expect(results).toEqual(["deny_once"]);
  });
});
