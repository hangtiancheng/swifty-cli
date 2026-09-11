import { Box, Text, useWindowSize } from "ink";
import type { ReactNode } from "react";

import { THEME } from "./styles.js";
import { truncateToWidth } from "./terminal-text.js";

interface SelectorFrameProps {
  children: ReactNode;
  compact?: boolean;
  hint: string;
  subtitle?: string;
  title: string;
  width?: number;
}

export function SelectorFrame({
  children,
  compact = false,
  hint,
  subtitle,
  title,
  width,
}: SelectorFrameProps) {
  const { columns } = useWindowSize();
  const frameWidth = Math.max(1, width ?? columns);
  const padding = frameWidth > 2 ? 1 : 0;
  const contentWidth = frameWidth - padding * 2;
  const rule = "─".repeat(frameWidth);
  const singleLine = (text: string) =>
    truncateToWidth(text.replace(/\s*\n\s*/g, " "), contentWidth);

  return (
    <Box flexDirection="column" flexShrink={0} width="100%">
      <Text color={THEME.border} wrap="truncate-end">
        {rule}
      </Text>
      <Box flexDirection="column" paddingX={padding}>
        <Text bold color={THEME.text} wrap="truncate-end">
          {singleLine(title)}
        </Text>
        {subtitle ? (
          <Text color={THEME.muted} wrap="truncate-end">
            {singleLine(subtitle)}
          </Text>
        ) : null}
        <Box flexDirection="column" marginTop={compact ? 0 : 1}>
          {children}
        </Box>
        <Text color={THEME.dim} wrap="truncate-end">
          {singleLine(hint)}
        </Text>
      </Box>
      <Text color={THEME.border} wrap="truncate-end">
        {rule}
      </Text>
    </Box>
  );
}
