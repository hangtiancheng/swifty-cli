import sliceAnsi from "slice-ansi";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

export function visibleWidth(text: string): number {
  return stringWidth(text);
}

export function truncateToWidth(text: string, width: number, suffix = "…"): string {
  const columns = Math.max(0, Math.floor(width));
  if (visibleWidth(text) <= columns) {
    return text;
  }
  const ending = sliceAnsi(suffix, 0, columns);
  return sliceAnsi(text, 0, Math.max(0, columns - visibleWidth(ending))) + ending;
}

export function wrapToLines(text: string, width: number): string[] {
  return wrapAnsi(text, Math.max(1, Math.floor(width)), {
    hard: true,
    wordWrap: false,
    trim: false,
  }).split("\n");
}
