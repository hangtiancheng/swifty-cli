export function formatToolOutputPreview(toolName: string, text: string): string {
  const normalized = text.trimEnd();
  const lines = normalized.split("\n");
  const lowerName = toolName.toLowerCase();
  const limit = lowerName.includes("grep")
    ? 15
    : lowerName.includes("glob") || lowerName.includes("find") || lowerName.includes("list")
      ? 20
      : lowerName.includes("bash") || lowerName.includes("powershell")
        ? 5
        : 10;
  if (lines.length <= limit) {
    return normalized;
  }
  const visible =
    lowerName.includes("bash") || lowerName.includes("powershell")
      ? lines.slice(-limit)
      : lines.slice(0, limit);
  return `${visible.join("\n")}\n… (${String(lines.length - limit)} more lines, Ctrl+O to expand)`;
}
