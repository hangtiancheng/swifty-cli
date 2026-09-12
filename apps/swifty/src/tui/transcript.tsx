import { Box, Static, Text } from "ink";

import { version } from "../version.js";

import { CommittedMessage, type ChatMessage } from "./chat.js";
import { THEME } from "./styles.js";

interface Props {
  messages: ChatMessage[];
  sessionId: string;
  termWidth: number;
  expanded: boolean;
  model: string;
  workDir: string;
}

export function Transcript({ messages, sessionId, termWidth, expanded, model, workDir }: Props) {
  return (
    <Static
      key={`transcript-${sessionId}-${String(termWidth)}-${String(expanded)}`}
      items={[
        { type: "brand" as const, key: "brand" },
        ...messages.map((message, index) => ({
          type: "message" as const,
          key: `message-${String(index)}`,
          message,
        })),
      ]}
    >
      {(item) =>
        item.type === "brand" ? (
          <Box key={item.key} flexDirection="column" marginBottom={1} marginTop={1} paddingLeft={1}>
            <Text>
              <Text bold color={THEME.accent}>
                Swifty
              </Text>
              <Text color={THEME.dim}> v{version}</Text>
            </Text>
            <Text color={THEME.muted}>
              Esc interrupt · Ctrl+C clear/exit · / commands · Ctrl+O details · Ctrl+T teams
            </Text>
            <Text color={THEME.dim} wrap="truncate-end">
              {model} · {workDir}
            </Text>
          </Box>
        ) : (
          <CommittedMessage key={item.key} message={item.message} expanded={expanded} />
        )
      }
    </Static>
  );
}
