import {
  clampToGraphemeBoundary,
  nextGraphemeBoundary,
  previousGraphemeBoundary,
} from "./terminal-text.js";

export interface PasteStore {
  counter: number;
  imageCounter?: number;
  entries: Record<string, string>;
}

const MARKER = /\[paste #\d+ (?:\+\d+ lines|\d+ chars)\]|\[Image #\d+\]/g;

export function collapsePaste(
  text: string,
  store?: PasteStore,
): { text: string; store?: PasteStore } {
  const lineCount = text.split("\n").length;
  if (lineCount <= 10 && text.length <= 1000) {
    return { text, store };
  }
  const counter = (store?.counter ?? 0) + 1;
  const detail = lineCount > 10 ? `+${String(lineCount)} lines` : `${String(text.length)} chars`;
  const marker = `[paste #${String(counter)} ${detail}]`;
  return {
    text: marker,
    store: { ...store, counter, entries: { ...store?.entries, [marker]: text } },
  };
}

export function collapseImage(
  reference: string,
  store?: PasteStore,
): { text: string; store: PasteStore } {
  const imageCounter = (store?.imageCounter ?? 0) + 1;
  const marker = `[Image #${String(imageCounter)}]`;
  return {
    text: marker,
    store: {
      counter: store?.counter ?? 0,
      imageCounter,
      entries: { ...store?.entries, [marker]: reference },
    },
  };
}

export function expandPastes(text: string, store?: PasteStore): string {
  // One pass: marker-like text inside pasted content is literal, never expanded again.
  return store ? text.replace(MARKER, (marker) => store.entries[marker] ?? marker) : text;
}

export function inputBoundary(
  text: string,
  index: number,
  direction: "previous" | "next" | "clamp",
  store?: PasteStore,
): number {
  if (store) {
    for (const match of text.matchAll(MARKER)) {
      if (store.entries[match[0]] === undefined) {
        continue;
      }
      const start = match.index;
      const end = start + match[0].length;
      if (direction === "next" && start <= index && index < end) {
        return end;
      }
      if (start < index && (index < end || (direction === "previous" && index === end))) {
        return start;
      }
    }
  }
  return direction === "next"
    ? nextGraphemeBoundary(text, index)
    : direction === "previous"
      ? previousGraphemeBoundary(text, index)
      : clampToGraphemeBoundary(text, index);
}
