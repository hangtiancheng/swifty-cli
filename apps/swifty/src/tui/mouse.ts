/**
 * SGR mouse tracking.
 *
 * Under the alt-screen the terminal has no scrollback region, so by default it
 * translates wheel events into ↑/↓ arrow keys sent to the program, which makes
 * the wheel accidentally trigger the input box's "input history". Once SGR mouse
 * tracking is enabled, the wheel is reported as mouse escape sequences instead,
 * the arrow keys go back to their normal job, and scrolling is handled by the
 * application itself.
 *
 * 1000: report button-press events (including the wheel); 1006: use the SGR
 * extended format, whose coordinates are not limited to 223 columns.
 */
const ENABLE = "\x1b[?1000h\x1b[?1006h";
const DISABLE = "\x1b[?1000l\x1b[?1006l";

export function enableMouseTracking(stdout: NodeJS.WriteStream): void {
  stdout.write(ENABLE);
}

export function disableMouseTracking(stdout: NodeJS.WriteStream): void {
  stdout.write(DISABLE);
}

/**
 * After Ink strips the leading ESC from an SGR mouse sequence, useInput
 * receives input shaped like `[<64;10;20M`. This kind of input must not reach
 * the input box, so it has to be recognized and filtered out first.
 */
export const MOUSE_SEQUENCE_RE = /^\[<\d+;\d+;\d+[Mm]$/;

export function isMouseSequence(input: string): boolean {
  return MOUSE_SEQUENCE_RE.test(input);
}

export type WheelDirection = "up" | "down";

/**
 * Decode the wheel direction from a mouse sequence: button code 64 is scroll
 * up, 65 is scroll down; anything else (clicks, drags) is ignored.
 */
export function parseWheel(input: string): WheelDirection | null {
  const m = /^\[<(\d+);\d+;\d+[Mm]$/.exec(input);
  if (!m) {
    return null;
  }
  const button = Number(m[1]);
  if (button === 64) {
    return "up";
  }
  if (button === 65) {
    return "down";
  }
  return null;
}
