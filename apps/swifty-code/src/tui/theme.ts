// TUI theme utilities — amber accent palette (preserved from SwiftyCode original)
// Visual constants (COLORS/ICONS/BORDER_COLORS) live in styles.ts
export const ACCENT = "#d4a017";
export const ACCENT_BRIGHT = "#fbbf24";

// Format a duration in milliseconds to a human-readable string
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes)}m ${String(remainingSeconds)}s`;
}

// Truncate a string to a maximum length, adding ellipsis if needed
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

// Context bar width in characters
const CONTEXT_BAR_WIDTH = 20;

// Render a context usage progress bar
export function contextBarFill(pct: number): string {
  const clamped = Math.max(0, Math.min(1, pct));
  const filled = Math.round(clamped * CONTEXT_BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(CONTEXT_BAR_WIDTH - filled);
}

// Determine the color for a context percentage based on threshold
export function contextBarColor(pct: number): string {
  if (pct >= 0.85) return "#fb7185";
  if (pct >= 0.7) return "#fbbf24";
  return "#525252";
}

// Format an ISO timestamp to a short HH:MM:SS string for inline display
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
