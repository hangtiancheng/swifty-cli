/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
