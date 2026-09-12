/**
 * Prepares a raw lucide-static SVG string for rendering via `unsafeHTML`.
 * Strips the license comment, optionally resizes the intrinsic 24px box and
 * merges Tailwind classes into the svg's own class attribute.
 */
export function icon(svg: string, className?: string, size?: number): string {
  let out = svg.replace(/<!--[^>]*-->\s*/g, "");
  if (size !== undefined) {
    out = out
      .replace(/width="24"/, `width="${size}"`)
      .replace(/height="24"/, `height="${size}"`);
  }
  if (className) {
    out = out.replace(/class="lucide[^"]*"/, `class="lucide ${className}"`);
  }
  return out;
}
