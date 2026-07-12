// PermissionDialog: Swifty-style permission confirmation with 4 options for daemon
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { COLORS, ICONS } from "./styles.js";

export type PermissionAction = "allow_once" | "always_allow" | "deny_once" | "always_deny";

const PERMISSION_OPTIONS: { label: string; action: PermissionAction }[] = [
  { label: "Yes", action: "allow_once" },
  {
    label: "Yes, and don't ask again for this pattern",
    action: "always_allow",
  },
  { label: "No", action: "deny_once" },
  { label: "No, and always deny this pattern", action: "always_deny" },
];

interface PermissionDialogProps {
  toolName: string;
  argsSummary: string;
  onComplete: (action: PermissionAction) => void;
}

export function PermissionDialog(props: PermissionDialogProps): React.JSX.Element {
  const { toolName, argsSummary, onComplete } = props;
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : PERMISSION_OPTIONS.length - 1));
    } else if (key.downArrow) {
      setCursor((c) => (c < PERMISSION_OPTIONS.length - 1 ? c + 1 : 0));
    } else if (key.return) {
      const selected = PERMISSION_OPTIONS[cursor];
      if (selected) {
        onComplete(selected.action);
      }
    } else if (key.escape) {
      onComplete("deny_once");
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
      <Text bold>{COLORS.warning(`  ${toolName} command`)}</Text>
      {argsSummary ? (
        <Text>
          {" "}
          <Text dimColor>
            {argsSummary.length > 120 ? argsSummary.slice(0, 120) + "…" : argsSummary}
          </Text>
        </Text>
      ) : null}
      <Text dimColor> This command requires approval</Text>
      <Text> Do you want to proceed?</Text>
      {PERMISSION_OPTIONS.map((opt, i) => (
        <Text key={opt.label}>
          {i === cursor ? COLORS.tool(` ${ICONS.prompt} `) : "   "}
          {i === cursor ? (
            <Text color="cyan">{`${String(i + 1)}. ${opt.label}`}</Text>
          ) : (
            <Text dimColor>{`${String(i + 1)}. ${opt.label}`}</Text>
          )}
        </Text>
      ))}
    </Box>
  );
}
