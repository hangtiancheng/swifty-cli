import { Box, Text } from "ink";

import type { TeammateUIState } from "../teams/progress.js";
import { formatTokens, summarizeActivities } from "../teams/progress.js";

import { THEME } from "./styles.js";

interface TeammateSpinnerLineProps {
  state: TeammateUIState;
  isLast: boolean;
  isSelected?: boolean;
}

function statusColor(status: TeammateUIState["status"]): string {
  if (status === "completed") {
    return THEME.success;
  }
  if (status === "failed") {
    return THEME.error;
  }
  if (status === "stopped") {
    return THEME.warning;
  }
  return THEME.muted;
}

export function TeammateSpinnerLine({ state, isLast, isSelected }: TeammateSpinnerLineProps) {
  const activity = summarizeActivities(state.progress.recentActivities) || state.spinnerVerb;
  const status = state.status === "running" ? `${activity}${activity ? "..." : ""}` : state.status;

  return (
    <Box>
      <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? "› " : "  "}</Text>
      <Text color={THEME.dim}>{isLast ? "└─ " : "├─ "}</Text>
      <Text color={THEME.accent}>@{state.name}</Text>
      <Text color={statusColor(state.status)}> {status}</Text>
      <Text color={THEME.dim}>
        {` · ${String(state.progress.toolUseCount)} tools · ${formatTokens(state.progress.tokenCount)} tokens`}
      </Text>
    </Box>
  );
}
