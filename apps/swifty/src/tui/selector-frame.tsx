import { Box, Text, useStdout } from "ink";
import type { ReactNode } from "react";

import { THEME } from "./styles.js";

interface SelectorFrameProps {
  children: ReactNode;
  hint: string;
  subtitle?: string;
  title: string;
}

export function SelectorFrame({ children, hint, subtitle, title }: SelectorFrameProps) {
  const { stdout } = useStdout();
  const rule = "─".repeat(Math.max(8, stdout.columns || 80));

  return (
    <Box flexDirection="column">
      <Text color={THEME.border}>{rule}</Text>
      <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <Text bold color={THEME.text}>
          {title}
        </Text>
        {subtitle ? <Text color={THEME.muted}>{subtitle}</Text> : null}
        <Box flexDirection="column" marginTop={1}>
          {children}
        </Box>
        <Text color={THEME.dim}>{hint}</Text>
      </Box>
      <Text color={THEME.border}>{rule}</Text>
    </Box>
  );
}
