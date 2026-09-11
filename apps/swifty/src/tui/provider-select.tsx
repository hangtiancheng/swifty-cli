import Fuse from "fuse.js";
import { useInput } from "ink";
import { useMemo, useState } from "react";

import type { ProviderConfig } from "../config/config.js";

import { SelectorList, SelectorListRow } from "./selector-list.js";
import { updateSelectorQuery } from "./selector-search.js";

interface ProviderSelectProps {
  currentProviderName?: string;
  reservedRows?: number;
  providers: ProviderConfig[];
  onCancel?: () => void;
  onSelect: (provider: ProviderConfig) => void;
}

export function ProviderSelect({
  currentProviderName,
  reservedRows,
  providers,
  onCancel,
  onSelect,
}: ProviderSelectProps) {
  const [query, setQuery] = useState("");
  const [focusedName, setFocusedName] = useState(currentProviderName);
  const fuse = useMemo(
    () =>
      new Fuse(providers, {
        keys: ["name", "model", "protocol"],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [providers],
  );
  const matches = useMemo(
    () => (query.trim() ? fuse.search(query.trim()).map(({ item }) => item) : providers),
    [fuse, providers, query],
  );
  const cursor = Math.max(
    0,
    matches.findIndex((provider) => provider.name === focusedName),
  );

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
    } else if (key.upArrow || key.downArrow) {
      if (matches.length > 0) {
        const next = (cursor + (key.upArrow ? -1 : 1) + matches.length) % matches.length;
        setFocusedName(matches[next].name);
      }
    } else if (key.return) {
      const provider = matches.at(cursor);
      if (provider) {
        onSelect(provider);
      }
    } else {
      const nextQuery = updateSelectorQuery(query, input, key);
      if (nextQuery !== query) {
        setQuery(nextQuery);
        setFocusedName(nextQuery.trim() ? undefined : currentProviderName);
      }
    }
  });

  return (
    <SelectorList
      cursor={cursor}
      emptyText={query.trim() ? "No matching providers" : "No providers configured"}
      hint={`↑↓ navigate · Enter select${onCancel ? " · Esc cancel" : ""} · Ctrl+U clear`}
      itemCount={matches.length}
      itemHeight={1}
      query={query}
      title="Select provider"
      totalCount={providers.length}
      reservedRows={reservedRows}
    >
      {(start, count, width) =>
        matches
          .slice(start, start + count)
          .map((provider, index) => (
            <SelectorListRow
              key={provider.name}
              current={provider.name === currentProviderName}
              description={`${provider.protocol} · ${provider.model}`}
              focused={start + index === cursor}
              label={provider.name}
              width={width}
            />
          ))
      }
    </SelectorList>
  );
}
