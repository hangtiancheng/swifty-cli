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

import chalk from "chalk";

export const COLORS = {
  primary: chalk.hex("#42b883"),
  white: chalk.bold.white,
  dim: chalk.dim,
  black: chalk.black,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.bold.red,
  muted: chalk.gray,
  thinking: chalk.hex("#42b883ee"),
  tool: chalk.cyan,
  user: chalk.bold.blue,
  assistant: chalk.bold.hex("#42b883"),
} as const;

export const ICONS = {
  prompt: ">",
  thinking: "✻",
  tool: "⏺",
  success: "✓",
  error: "✗",
  arrow: "→" satisfies "→" | "←",
  dot: "·",
} as const;

export const CMD_COLORS = {
  local: "⚙",
  local_ui: "⚙",
  skill_fork: "★",
  prompt: "◇",
} as const;

// TODO: Migrate to green theme color.
export const BORDER_COLORS = {
  idle: "gray",
  focused: "#a78bfa",
  agent: "#a855f6",
  error: "red",
} as const;
