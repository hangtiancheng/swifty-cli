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
