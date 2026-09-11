import { Box, Text, useInput } from "ink";
import { useState } from "react";

import type { SessionInfo } from "../session/session.js";

import { getListWindowStart } from "./list-window.js";
import { SelectorFrame } from "./selector-frame.js";
import { THEME } from "./styles.js";

interface SessionSelectorProps {
  sessions: SessionInfo[];
  onCancel: () => void;
  onSelect: (sessionId: string) => void;
}

export function SessionSelector({ sessions, onCancel, onSelect }: SessionSelectorProps) {
  const [cursor, setCursor] = useState(0);
  const windowStart = getListWindowStart(sessions.length, cursor, 10);
  const visibleSessions = sessions.slice(windowStart, windowStart + 10);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((current) => (current > 0 ? current - 1 : sessions.length - 1));
    } else if (key.downArrow) {
      setCursor((current) => (current < sessions.length - 1 ? current + 1 : 0));
    } else if (key.return) {
      const session = sessions[cursor];
      if (session) {
        onSelect(session.id);
      }
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <SelectorFrame
      hint={`↑↓ navigate · Enter resume · Escape cancel${sessions.length > 10 ? ` · ${String(cursor + 1)}/${String(sessions.length)}` : ""}`}
      title="Resume session"
    >
      {visibleSessions.map((session, index) => {
        const selected = windowStart + index === cursor;
        return (
          <Box
            key={session.id}
            backgroundColor={selected ? THEME.selectedBg : undefined}
            flexDirection="column"
            paddingLeft={1}
            paddingRight={1}
            width="100%"
          >
            <Text color={selected ? THEME.accent : THEME.text} wrap="truncate-end">
              {selected ? "› " : "  "}
              {session.firstMessage || "(empty session)"}
            </Text>
            <Text color={THEME.dim} wrap="truncate-end">
              {`  ${session.id} · ${String(session.messageCount)} messages · ${formatRelativeTime(session.modTime)}`}
            </Text>
          </Box>
        );
      })}
    </SelectorFrame>
  );
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return `${String(seconds)}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  return `${String(Math.floor(hours / 24))}d ago`;
}
