import { homedir } from "node:os";

import { Box, Text } from "ink";

import { THEME } from "./styles.js";

interface FooterProps {
  contextWindow: number;
  inputTokens: number;
  model: string;
  outputTokens: number;
  permissionMode: string;
  provider: string;
  sessionId: string;
  workDir: string;
}

function compactPath(path: string): string {
  const home = homedir();
  return path === home
    ? "~"
    : path.startsWith(`${home}/`)
      ? `~/${path.slice(home.length + 1)}`
      : path;
}

function formatTokens(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export function Footer(props: FooterProps) {
  const {
    contextWindow,
    inputTokens,
    model,
    outputTokens,
    permissionMode,
    provider,
    sessionId,
    workDir,
  } = props;
  const used = inputTokens + outputTokens;
  const percentage = contextWindow > 0 ? (used / contextWindow) * 100 : 0;
  const contextColor =
    percentage >= 90 ? THEME.error : percentage >= 70 ? THEME.warning : THEME.dim;

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box width="100%">
        <Box flexGrow={1} minWidth={1}>
          <Text color={THEME.dim} wrap="truncate-end">
            {compactPath(workDir)}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={THEME.dim}> · {sessionId}</Text>
        </Box>
      </Box>
      <Box justifyContent="space-between" width="100%">
        <Text color={THEME.dim}>
          ↑{formatTokens(inputTokens)} ↓{formatTokens(outputTokens)}{" "}
          <Text color={contextColor}>
            {percentage.toFixed(1)}%/{formatTokens(contextWindow)}
          </Text>
        </Text>
        <Text color={THEME.dim} wrap="truncate-start">
          {provider}/{model} · {permissionMode}
        </Text>
      </Box>
    </Box>
  );
}
