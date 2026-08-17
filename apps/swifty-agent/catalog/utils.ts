import type { CSSProperties } from "react";

export const JUSTIFY_CLASSES: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  stretch: "justify-stretch",
};

export const ALIGN_CLASSES: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

export function justifyClass(justify?: string) {
  return (justify && JUSTIFY_CLASSES[justify]) || "justify-start";
}

export function alignClass(align?: string) {
  return (align && ALIGN_CLASSES[align]) || "items-stretch";
}

// min-width/min-height 0 let weighted children shrink below their intrinsic
// content size, otherwise large content forces the container to overflow.
export function weightStyle(weight?: number): CSSProperties {
  if (typeof weight !== "number") return {};
  return { flex: `${weight}`, minWidth: 0, minHeight: 0 };
}
