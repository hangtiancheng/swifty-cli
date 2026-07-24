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

// TUI visual constants — Swifty-style chalk functions with amber accent
import chalk from "chalk";

chalk.level = 3;

export const COLORS = {
  primary: chalk.hex("#d4a017"),
  white: chalk.bold.white,
  dim: chalk.dim,
  black: chalk.black,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.bold.red,
  muted: chalk.gray,
  thinking: chalk.hex("#d4a017ee"),
  tool: chalk.cyan,
  user: chalk.bold.blue,
  assistant: chalk.bold.hex("#d4a017"),
} as const;

export const ICONS = {
  prompt: ">",
  thinking: "✻",
  tool: "⏺",
  success: "✓",
  error: "✗",
  arrow: "→",
  dot: "·",
} as const;

export const BORDER_COLORS = {
  idle: "gray",
  focused: "#d4a017",
  agent: "#fbbf24",
  error: "red",
} as const;
