import { Box, Text, useStdout } from "ink";

import { renderMarkdown } from "./markdown.js";
import { THEME } from "./styles.js";
import { truncateToWidth, wrapToLines } from "./terminal-text.js";

interface Props {
  text: string;
  duration?: number;
  expanded: boolean;
  streaming?: boolean;
}

export function ThinkingBlock({ text, duration, expanded, streaming = false }: Props) {
  const { stdout } = useStdout();
  if (!text.trim() && !duration) {
    return null;
  }
  const width = Math.max(1, (stdout.columns || 80) - 2);
  const label = duration ? `Thinking (${duration.toFixed(1)}s)` : "Thinking...";
  let content =
    expanded && text.trim()
      ? renderMarkdown(text.trim(), width, "thinking")
      : truncateToWidth(label, width);
  if (streaming && expanded) {
    const lines = wrapToLines(content, width);
    const limit = Math.max(1, Math.floor((stdout.rows || 24) / 4));
    if (lines.length > limit) {
      content = limit === 1 ? "…" : ["…", ...lines.slice(-(limit - 1))].join("\n");
    }
  }
  return (
    <Box paddingLeft={1} paddingRight={1} marginTop={1}>
      <Text color={THEME.thinking} italic>
        {content}
      </Text>
    </Box>
  );
}
