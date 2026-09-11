import { Box, Text, useInput } from "ink";
import { useState } from "react";

import type { ProviderConfig } from "../config/config.js";

import { SelectorFrame } from "./selector-frame.js";
import { ICONS, THEME } from "./styles.js";

interface ProviderSelectProps {
  providers: ProviderConfig[];
  onCancel?: () => void;
  onSelect: (provider: ProviderConfig) => void;
}

export function ProviderSelect({ providers, onCancel, onSelect }: ProviderSelectProps) {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((current) => (current > 0 ? current - 1 : providers.length - 1));
    } else if (key.downArrow) {
      setCursor((current) => (current < providers.length - 1 ? current + 1 : 0));
    } else if (key.return) {
      const provider = providers[cursor];
      if (provider) {
        onSelect(provider);
      }
    } else if (key.escape) {
      onCancel?.();
    }
  });

  return (
    <SelectorFrame
      hint={`↑↓ navigate · Enter select${onCancel ? " · Escape cancel" : ""}`}
      title="Select provider"
    >
      {providers.map((provider, index) => {
        const selected = index === cursor;
        return (
          <Box
            key={provider.name}
            backgroundColor={selected ? THEME.selectedBg : undefined}
            paddingLeft={1}
            paddingRight={1}
            width="100%"
          >
            <Text color={selected ? THEME.accent : THEME.text}>
              {selected ? `${ICONS.arrow} ` : "  "}
              {provider.name}
            </Text>
            <Text color={THEME.muted} wrap="truncate-end">
              {`  ${provider.protocol} · ${provider.model}`}
            </Text>
          </Box>
        );
      })}
    </SelectorFrame>
  );
}
