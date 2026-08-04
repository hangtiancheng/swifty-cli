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

import { markedTerminal } from "@swifty.js/marked-terminal";
import chalk from "chalk";
import { Box, Text, useStdout } from "ink";
import { marked } from "marked";
import React, { useRef } from "react";

import { createChildLogger } from "../logger/logger.js";

import { DiffLines } from "./diff-render.js";
import { isDiffTool } from "./is-diff-tool.js";
import { COLORS, ICONS } from "./styles.js";

const log = createChildLogger({ module: "tui" });

chalk.level = 3;
marked.use(markedTerminal({ showSectionPrefix: false }));

const isPromise = (val: unknown): val is Promise<unknown> => {
  return typeof val === "object" && val !== null && "then" in val && typeof val.then === "function";
};

function renderMarkdown(text: string): string {
  try {
    let result = marked.parse(text);
    if (isPromise(result)) {
      return text;
    }
    result = result.replace(/\*\*([^*]+)\*\*/g, (_, t) => chalk.bold(t));
    result = result.replace(/^( {4})\* /gm, "  - ");
    return result;
  } catch (err) {
    log.error({ err }, "tui operation failed");
    return text;
  }
}

export interface ToolSummaryItem {
  toolName: string;
  argsSummary: string;
  output: string;
  isError: boolean;
  elapsed: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "turn_summary";
  content: string;
  // turn_summary fields
  thinkingDuration?: number;
  toolSummary?: ToolSummaryItem[];
}

interface ChatViewProps {
  messages: ChatMessage[];
  streamingText?: string;
  expanded?: boolean;
}

/**
 * Incremental streaming Markdown rendering: Only re-parses the trailing incomplete chunk,
 * reusing the stable prefix cache.
 * Stable-prefix cache hits reduce the overall complexity from O(n²) to O(n).
 */
// ANSI escape sequence regex: Used to calculate the width of visible characters
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;

function StreamingText({ text }: { text: string }) {
  const stableRef = useRef({ text: "", rendered: "" });
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;
  // Reserve 12 physical lines for dynamic area components like Spinner, ToolDisplay, InputBox, user messages, etc.
  const maxPhysical = Math.max(5, (stdout.rows || 24) - 12);

  const boundary = text.lastIndexOf("\n\n");
  const stableEnd =
    boundary >= 0 && boundary + 2 > stableRef.current.text.length
      ? boundary + 2
      : stableRef.current.text.length;
  const stableText = text.slice(0, stableEnd);
  const unstableText = text.slice(stableEnd);

  if (stableText.length > stableRef.current.text.length) {
    stableRef.current = {
      text: stableText,
      rendered: renderMarkdown(stableText),
    };
  }

  const unstableRendered = unstableText ? renderMarkdown(unstableText) : "";
  const fullRendered = stableRef.current.rendered + unstableRendered;

  // Truncate based on physical lines: Take from the end backwards until physical line limit is reached
  const lines = fullRendered.split("\n");
  let physicalCount = 0;
  let cutIndex = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const visible = lines[i].replace(ANSI_RE, "").length;
    const wrapped = Math.max(1, Math.ceil(visible / cols));
    if (physicalCount + wrapped > maxPhysical) {
      break;
    }
    physicalCount += wrapped;
    cutIndex = i;
  }

  const truncated = cutIndex > 0;
  const visibleText = truncated ? "…\n" + lines.slice(cutIndex).join("\n") : fullRendered;

  return (
    <Text>
      {COLORS.assistant(`${ICONS.dot} `)}
      {visibleText}
    </Text>
  );
}

export const ChatView = React.memo(function (props: ChatViewProps) {
  const { messages, streamingText, expanded = false } = props;
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {messages.map((msg, i) => (
        <MessageBlock key={i} message={msg} expanded={expanded} />
      ))}
      {streamingText !== undefined && streamingText !== "" && (
        <Box>
          <StreamingText text={streamingText} />
        </Box>
      )}
    </Box>
  );
});

/**
 * CommittedMessage renders a single finalized message for use inside Ink's
 * <Static> component. Once rendered, Static never re-renders it, eliminating
 * flicker from the scrollback history.
 */

interface CommitMessageProps {
  message: ChatMessage;
  expanded?: boolean | undefined;
}
export function CommittedMessage(props: CommitMessageProps) {
  const { message, expanded = false } = props;
  return (
    <Box paddingLeft={1}>
      <MessageBlock message={message} expanded={expanded} />
    </Box>
  );
}

interface TurnSummaryBlockProps {
  message: ChatMessage;
  expanded: boolean;
}

function clampOutput(text: string): string {
  return text.length > 200
    ? text.slice(0, 200) + `\n…${String(text.length - 200)} chars (ctrl+o to expand)`
    : text;
}

function TurnSummaryBlock(props: TurnSummaryBlockProps) {
  const { message, expanded } = props;
  const { content: thinkingText, thinkingDuration, toolSummary = [] } = message;
  if (!thinkingText && !thinkingDuration && toolSummary.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" marginBottom={0}>
      {(thinkingText !== "" || (thinkingDuration !== undefined && thinkingDuration >= 1)) && (
        <Text dimColor>
          {COLORS.thinking(`${ICONS.thinking} `)}Thought for{" "}
          {Math.max(1, Math.round(thinkingDuration ?? 0))}s
        </Text>
      )}
      {thinkingText !== "" && (
        <Box paddingLeft={2}>
          <Text dimColor italic>
            {expanded ? thinkingText.trimEnd() : clampOutput(thinkingText)}
          </Text>
        </Box>
      )}
      {toolSummary.map((t, i) => {
        const icon = t.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
        // Summaries rebuilt from a resumed session carry no timing (elapsed 0) — omit the suffix.
        const timeStr = t.elapsed > 0 ? ` (${t.elapsed.toFixed(1)}s)` : "";

        const isDiff = isDiffTool(t.toolName);
        const output = t.output ? (expanded ? t.output.trimEnd() : clampOutput(t.output)) : "";
        return (
          <Box key={i} flexDirection="column" marginBottom={0}>
            <Text>
              {icon} {COLORS.tool(t.toolName)}
              {t.argsSummary ? <Text dimColor> {t.argsSummary}</Text> : null}
              <Text dimColor>{timeStr}</Text>
            </Text>
            {output ? (
              <Box paddingLeft={4}>
                {isDiff ? <DiffLines text={output} /> : <Text dimColor>{output}</Text>}
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

interface MessageBlockProps {
  message: ChatMessage;
  expanded: boolean;
}

function MessageBlock(props: MessageBlockProps) {
  const { message, expanded } = props;

  switch (message.role) {
    case "user": {
      return (
        <Box marginBottom={0}>
          <Text>
            {COLORS.primary(`${ICONS.prompt} `)}
            {message.content}
          </Text>
        </Box>
      );
    }

    case "assistant": {
      return (
        <Box marginBottom={0}>
          <Text>{renderMarkdown(message.content)}</Text>
        </Box>
      );
    }

    case "turn_summary": {
      return <TurnSummaryBlock message={message} expanded={expanded} />;
    }

    case "system": {
      return (
        <Box marginBottom={0}>
          <Text dimColor>{message.content}</Text>
        </Box>
      );
    }
    default: {
      return null;
    }
  }
}
