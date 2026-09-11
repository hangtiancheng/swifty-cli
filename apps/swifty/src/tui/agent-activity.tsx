import { Box, Text } from "ink";

import type { TeammateUIState } from "../teams/progress.js";

import { THEME } from "./styles.js";
import { TeammateSpinnerTree } from "./teammate-spinner-tree.js";
import { ToolBlock, ToolDisplay, type ToolBlockInfo } from "./tool-display.js";

export interface SubagentProgress {
  id: number;
  label: string;
  turn: number;
  lastTool?: string;
}

interface Props {
  tools: ToolBlockInfo[];
  subagents: SubagentProgress[];
  teammates: TeammateUIState[];
  isStreaming: boolean;
  isAsking: boolean;
  expanded: boolean;
  leaderTokens: number;
}

export function AgentActivity({
  tools,
  subagents,
  teammates,
  isStreaming,
  isAsking,
  expanded,
  leaderTokens,
}: Props) {
  return (
    <>
      {tools.length > 0 && !isAsking && subagents.length === 0 && (
        <ToolDisplay tools={tools} expanded={expanded} />
      )}
      {subagents.length > 0 && !isAsking && (
        <>
          <ToolDisplay
            tools={tools.filter((tool) => !(tool.toolName === "Agent" && tool.loading))}
            expanded={expanded}
          />
          <Box flexDirection="column" paddingLeft={1}>
            {subagents.map((subagent, index) => {
              const tool = tools
                .filter((active) => active.toolName === "Agent" && active.loading)
                .at(index);
              return (
                <Box key={subagent.id} gap={1}>
                  {tool && <ToolBlock tool={tool} expanded={expanded} />}
                  <Text color={THEME.customMessageLabel}>
                    • {subagent.label} subagent · turn {subagent.turn}
                    {subagent.lastTool ? ` · ${subagent.lastTool}` : ""}
                  </Text>
                </Box>
              );
            })}
          </Box>
        </>
      )}
      {isStreaming && !isAsking && teammates.length > 0 && (
        <Box paddingLeft={1}>
          <TeammateSpinnerTree teammates={teammates} leaderTokens={leaderTokens} />
        </Box>
      )}
      {!isStreaming && teammates.some((teammate) => teammate.status === "running") && (
        <Box paddingLeft={1}>
          <TeammateSpinnerTree teammates={teammates} />
        </Box>
      )}
    </>
  );
}
