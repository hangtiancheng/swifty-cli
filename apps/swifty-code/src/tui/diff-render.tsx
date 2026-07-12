// Renders structured diff text as colored lines:
// lines starting with "+ " are green, "- " are red, others (context/summary) are dimmed.
import { Box, Text } from "ink";

interface DiffLinesProps {
  text: string;
}

export function DiffLines({ text }: DiffLinesProps): React.JSX.Element {
  const lines = text.split("\n");
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (line.startsWith("+ ")) {
          return (
            <Text key={String(i)} color="green">
              {line}
            </Text>
          );
        }
        if (line.startsWith("- ")) {
          return (
            <Text key={String(i)} color="red">
              {line}
            </Text>
          );
        }
        return (
          <Text key={String(i)} dimColor>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
