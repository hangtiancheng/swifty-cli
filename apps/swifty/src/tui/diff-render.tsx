import { Box, Text } from "ink";

/**
 * Renders the line-numbered diff text produced by buildDiff() as colored lines:
 * lines starting with "+ " are green, "- " are red, others (context/summary lines) are dimmed.
 */
export function DiffLines({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (line.startsWith("+ ")) {
          return (
            <Text key={i} color="green">
              {line}
            </Text>
          );
        }
        if (line.startsWith("- ")) {
          return (
            <Text key={i} color="red">
              {line}
            </Text>
          );
        }
        return (
          <Text key={i} dimColor>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
