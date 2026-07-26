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

import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProviderConfig } from "../config/config.js";
import { COLORS, ICONS } from "./styles.js";

interface ProviderSelectProps {
  providers: ProviderConfig[];
  onSelect: (provider: ProviderConfig) => void;
}

export function ProviderSelect(props: ProviderSelectProps) {
  const { providers, onSelect } = props;
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : providers.length - 1));
    } else if (key.downArrow) {
      setCursor((c) => (c < providers.length - 1 ? c + 1 : 0));
    } else if (key.return) {
      onSelect(providers[cursor]);
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
      <Text bold>{COLORS.primary("Select a provider:")}</Text>
      <Text dimColor> </Text>
      {providers.map((p, i) => (
        <Box key={p.name}>
          <Text>
            {i === cursor ? COLORS.primary(`${ICONS.prompt} `) : "  "}
            {i === cursor ? COLORS.white(p.name) : p.name}
            <Text dimColor>
              {" "}
              ({p.protocol} {ICONS.arrow} {p.model})
            </Text>
          </Text>
        </Box>
      ))}
      <Text dimColor>{"\n  ↑/↓ to navigate, Enter to select"}</Text>
    </Box>
  );
}
