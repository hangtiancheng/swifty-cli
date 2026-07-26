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

import { ICONS } from "./styles.js";
import { Box, Text } from "ink";

interface StatusBarProps {
  /** Currently not used */
  model: string;
  mode?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function StatusBar(props: StatusBarProps) {
  const { mode, inputTokens = 0, outputTokens = 0 } = props;
  const parts: string[] = [];
  if (mode) {
    parts.push(mode);
  }
  if (inputTokens > 0) {
    parts.push(`${formatTokens(inputTokens)}↓ ${formatTokens(outputTokens)}↑`);
  }

  if (parts.length === 0) {
    return null;
  }

  return (
    <Box paddingLeft={1} paddingTop={0} paddingBottom={0}>
      <Text dimColor>
        {parts.map((p, i) => (i > 0 ? ` ${ICONS.dot} ` : `${ICONS.dot} `) + p).join("")}
      </Text>
    </Box>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}
