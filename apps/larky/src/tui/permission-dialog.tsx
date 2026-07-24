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

// PermissionDialog: Swifty-style permission confirmation with 4 options for daemon
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { COLORS, ICONS } from "./styles.js";

export type PermissionAction = "allow_once" | "always_allow" | "deny_once" | "always_deny";

const PERMISSION_OPTIONS: { label: string; action: PermissionAction; shortcut: string }[] = [
  { label: "Allow once", action: "allow_once", shortcut: "y" },
  {
    label: "Allow always (don't ask again for this pattern)",
    action: "always_allow",
    shortcut: "a",
  },
  { label: "Deny once", action: "deny_once", shortcut: "n" },
  { label: "Deny always (always deny this pattern)", action: "always_deny", shortcut: "d" },
];

interface PermissionDialogProps {
  toolName: string;
  argsSummary: string;
  onComplete: (action: PermissionAction) => void;
}

export function PermissionDialog(props: PermissionDialogProps): React.JSX.Element {
  const { toolName, argsSummary, onComplete } = props;
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : PERMISSION_OPTIONS.length - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c < PERMISSION_OPTIONS.length - 1 ? c + 1 : 0));
      return;
    }
    if (key.return) {
      const selected = PERMISSION_OPTIONS[cursor];
      if (selected) {
        onComplete(selected.action);
      }
      return;
    }
    if (key.escape) {
      onComplete("deny_once");
      return;
    }
    // Single-key shortcuts: y/a/n/d and 1-4 (aligned with the old Python TUI)
    const lower = input.toLowerCase();
    const byShortcut = PERMISSION_OPTIONS.find((o) => o.shortcut === lower);
    if (byShortcut) {
      onComplete(byShortcut.action);
      return;
    }
    const digit = Number.parseInt(input, 10);
    if (digit >= 1 && digit <= PERMISSION_OPTIONS.length) {
      const selected = PERMISSION_OPTIONS[digit - 1];
      if (selected) {
        onComplete(selected.action);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
      <Text bold>{COLORS.warning(`  ${toolName} command`)}</Text>
      {argsSummary ? (
        <Text>
          {" "}
          <Text dimColor>
            {argsSummary.length > 120 ? argsSummary.slice(0, 120) + "…" : argsSummary}
          </Text>
        </Text>
      ) : null}
      <Text dimColor> This command requires approval</Text>
      <Text> Do you want to proceed?</Text>
      {PERMISSION_OPTIONS.map((opt, i) => (
        <Text key={opt.label}>
          {i === cursor ? COLORS.tool(` ${ICONS.prompt} `) : "   "}
          {i === cursor ? (
            <Text color="cyan">{`${String(i + 1)}. [${opt.shortcut}] ${opt.label}`}</Text>
          ) : (
            <Text dimColor>{`${String(i + 1)}. [${opt.shortcut}] ${opt.label}`}</Text>
          )}
        </Text>
      ))}
      <Text dimColor> y/a/n/d or 1-4 · ↑/↓ + enter · esc = deny once</Text>
    </Box>
  );
}
