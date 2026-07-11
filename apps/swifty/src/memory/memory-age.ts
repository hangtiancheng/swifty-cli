/**
 Memory freshness calculation and expiration reminders. Appends a prompt text 
 to memories older than 1 day, instructing the model that the memory may be 
 stale and should be verified before use.
 */
export function memoryAgeDays(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000));
}

export function memoryAge(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs);
  if (d === 0) {
    return "today";
  }
  if (d === 1) {
    return "yesterday";
  }
  return `${String(d)} days ago`;
}

export function memoryFreshnessText(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs);
  if (d <= 1) {
    return "";
  }
  return (
    `This memory is ${String(d)} days old. ` +
    `Memories are point-in-time observations, not live state — ` +
    `claims about code behavior or file:line citations may be outdated. ` +
    `Verify against current code before asserting as fact.`
  );
}
