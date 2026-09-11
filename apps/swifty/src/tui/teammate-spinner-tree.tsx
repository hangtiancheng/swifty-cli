import { Box, Text } from "ink";

import type { TeammateUIState } from "../teams/progress.js";
import { formatTokens } from "../teams/progress.js";

import { THEME } from "./styles.js";
import { TeammateSpinnerLine } from "./teammate-spinner-line.js";

interface TeammateSpinnerTreeProps {
  teammates: TeammateUIState[];
  leaderVerb?: string;
  leaderTokens?: number;
}

export function TeammateSpinnerTree({
  teammates,
  leaderVerb,
  leaderTokens,
}: TeammateSpinnerTreeProps) {
  if (teammates.length === 0) {
    return null;
  }

  const tokenSuffix =
    leaderTokens !== undefined && leaderTokens > 0 ? ` · ${formatTokens(leaderTokens)} tokens` : "";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={THEME.muted}>
        ┌─ team lead · {leaderVerb ?? "thinking"}...{tokenSuffix}
      </Text>
      {teammates.map((teammate, index) => (
        <TeammateSpinnerLine
          key={`${teammate.teamName}/${teammate.name}`}
          state={teammate}
          isLast={index === teammates.length - 1}
        />
      ))}
    </Box>
  );
}
