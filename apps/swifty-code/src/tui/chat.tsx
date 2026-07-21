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

// Chat rendering: streaming markdown, message blocks, and committed message wrapper
import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "@swifty.js/marked-terminal";
import { Box, Text, useStdout } from "ink";
import { useRef } from "react";

import { COLORS, ICONS } from "./styles.js";
import { DiffLines } from "./diff-render.js";
import { isDiffTool } from "./is-diff-tool.js";

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
  } catch {
    return text;
  }
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "thinking" | "tool_use" | "tool_result";
  content: string;
  toolName?: string;
  argsSummary?: string;
  isError?: boolean;
  elapsed?: number;
}

interface ChatViewProps {
  messages: ChatMessage[];
  streamingText: string | undefined;
  expanded: boolean;
}

// ANSI escape sequence regex for visible-width calculation
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;

function StreamingText({ text }: { text: string }): React.JSX.Element {
  const stableRef = useRef({ text: "", rendered: "" });
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;
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

  const lines = fullRendered.split("\n");
  let physicalCount = 0;
  let cutIndex = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const visible = lines[i]?.replace(ANSI_RE, "").length ?? 0;
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

export function ChatView(props: ChatViewProps): React.JSX.Element {
  const { messages, streamingText, expanded } = props;
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {messages.map((msg, i) => (
        <MessageBlock key={String(i)} message={msg} expanded={expanded} />
      ))}
      {streamingText !== undefined && streamingText !== "" ? (
        <Box>
          <StreamingText text={streamingText} />
        </Box>
      ) : null}
    </Box>
  );
}

interface CommitMessageProps {
  message: ChatMessage;
  expanded?: boolean;
}

export function CommittedMessage(props: CommitMessageProps): React.JSX.Element {
  const { message, expanded = false } = props;
  return (
    <Box paddingLeft={1}>
      <MessageBlock message={message} expanded={expanded} />
    </Box>
  );
}

interface MessageBlockProps {
  message: ChatMessage;
  expanded: boolean;
}

function MessageBlock(props: MessageBlockProps): React.JSX.Element {
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

    case "thinking": {
      return (
        <Box marginBottom={0}>
          <Text dimColor>
            {COLORS.thinking(`${ICONS.thinking} `)}
            {message.content.length > 200 ? message.content.slice(0, 200) + "..." : message.content}
          </Text>
        </Box>
      );
    }

    case "tool_use": {
      return (
        <Box marginBottom={0}>
          <Text>
            <Text color="magenta">●</Text> {COLORS.tool(message.toolName ?? "tool")}
            {message.argsSummary ? <Text dimColor> {message.argsSummary}</Text> : null}
          </Text>
        </Box>
      );
    }

    case "tool_result": {
      const icon = message.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
      const timeStr =
        message.elapsed !== undefined ? ` (${(message.elapsed / 1000).toFixed(1)}s)` : "";
      const isDiff = isDiffTool(message.toolName ?? "");

      return (
        <Box flexDirection="column" marginBottom={0}>
          <Text>
            {icon} {COLORS.tool(message.toolName ?? "tool")}
            {message.argsSummary ? <Text dimColor> {message.argsSummary}</Text> : null}
            <Text dimColor>{timeStr}</Text>
          </Text>
          {message.content ? (
            <Box paddingLeft={2}>
              {isDiff ? (
                <DiffLines text={message.content} />
              ) : (
                <Text dimColor>
                  {!expanded && message.content.length > 500
                    ? message.content.slice(0, 500) + "…  (ctrl+o to expand)"
                    : message.content}
                </Text>
              )}
            </Box>
          ) : null}
        </Box>
      );
    }

    case "system": {
      return (
        <Box marginBottom={0}>
          <Text dimColor>{message.content}</Text>
        </Box>
      );
    }
    default: {
      return <Text> </Text>;
    }
  }
}
