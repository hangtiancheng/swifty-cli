import { Box, Text } from "ink";

import { THEME } from "./styles.js";

interface PendingQueueProps {
  messages: string[];
}

export function PendingQueue({ messages }: PendingQueueProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1} paddingRight={1}>
      {messages.map((message, index) => (
        <Text key={`${String(index)}-${message}`} color={THEME.dim} wrap="truncate-end">
          Follow-up: {message.replaceAll("\n", " ")}
        </Text>
      ))}
      <Text color={THEME.dim}>↳ queued messages run after the current response</Text>
    </Box>
  );
}
