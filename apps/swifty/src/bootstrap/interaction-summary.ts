export interface InteractionSummary {
  agentActiveMs: number;
  failedToolCalls: number;
  sessionId: string;
  startedAt: number;
  successfulToolCalls: number;
  toolTimeMs: number;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes)}m ${String(remainder)}s`;
}

function percentage(value: number, total: number): string {
  return `${(total > 0 ? (value / total) * 100 : 0).toFixed(1)}%`;
}

function field(label: string, value: string): string {
  return ` ${`${label}:`.padEnd(28)}${value}`;
}

export function formatInteractionSummary(
  summary: InteractionSummary,
  endedAt = Date.now(),
): string {
  const totalToolCalls = summary.successfulToolCalls + summary.failedToolCalls;
  const apiTimeMs = Math.max(0, summary.agentActiveMs - summary.toolTimeMs);
  const successRate = totalToolCalls > 0 ? (summary.successfulToolCalls / totalToolCalls) * 100 : 0;

  return [
    " Interaction Summary",
    field("Session ID", summary.sessionId),
    field(
      "Tool Calls",
      `${String(totalToolCalls)} ( ✓ ${String(summary.successfulToolCalls)} x ${String(summary.failedToolCalls)} )`,
    ),
    field("Success Rate", `${successRate.toFixed(1)}%`),
    "",
    " Performance",
    field("Wall Time", formatDuration(endedAt - summary.startedAt)),

    field("Agent Active", formatDuration(summary.agentActiveMs)),
    field(
      "  > API Time",
      `${formatDuration(apiTimeMs)} (${percentage(apiTimeMs, summary.agentActiveMs)})`,
    ),
    field(
      "  > Tool Time",
      `${formatDuration(summary.toolTimeMs)} (${percentage(summary.toolTimeMs, summary.agentActiveMs)})`,
    ),
    "",
    ` To resume this session: swifty --resume ${summary.sessionId}`,
  ].join("\n");
}
