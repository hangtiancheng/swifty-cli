import sliceAnsi from "slice-ansi";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

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

/** Return the UTF-16 index immediately before the grapheme at `index`. */
export function previousGraphemeBoundary(text: string, index: number): number {
  const bounded = Math.max(0, Math.min(index, text.length));
  let previous = 0;
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index >= bounded) {
      return previous;
    }
    previous = segment.index;
  }
  return previous;
}

/** Return the UTF-16 index immediately after the grapheme at `index`. */
export function nextGraphemeBoundary(text: string, index: number): number {
  const bounded = Math.max(0, Math.min(index, text.length));
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index >= bounded) {
      return segment.index === bounded ? segment.index + segment.segment.length : segment.index;
    }
    if (segment.index + segment.segment.length > bounded) {
      return segment.index + segment.segment.length;
    }
  }
  return text.length;
}

/** Clamp a cursor index to the nearest grapheme boundary on its left. */
export function clampToGraphemeBoundary(text: string, index: number): number {
  const bounded = Math.max(0, Math.min(index, text.length));
  return nextGraphemeBoundary(text, previousGraphemeBoundary(text, bounded)) === bounded
    ? bounded
    : previousGraphemeBoundary(text, bounded);
}
