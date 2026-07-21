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

import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "tui" });

import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "@swifty.js/marked-terminal";
import { COLORS, ICONS } from "./styles.js";
import { Box, Text, useStdout } from "ink";
import { useRef } from "react";
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
  role: "user" | "assistant" | "system" | "thinking" | "tool_use" | "tool_result" | "turn_summary";
  content: string;
  toolName?: string;
  argsSummary?: string;
  isError?: boolean;
  elapsed?: number;
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
 * Inspired by Claude Code's StreamingMarkdown design, reducing complexity from O(n²) to O(n).
 */
// ANSI escape sequence regex: Used to calculate the width of visible characters
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;

/**
 * Calculates the number of physical lines (considering terminal width wrapping) to prevent
 * dynamic areas from exceeding the height and triggering Ink's clearTerminal.
 * ANSI escape sequences in logical lines do not occupy width; visible characters exceeding
 * the terminal width automatically wrap.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function countPhysicalLines(lines: string[], cols: number): number {
  let total = 0;
  for (const line of lines) {
    const visible = line.replace(ANSI_RE, "").length;
    total += Math.max(1, Math.ceil(visible / cols));
  }
  return total;
}

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

export function ChatView(props: ChatViewProps) {
  const { messages, streamingText, expanded = false } = props;
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {messages.map((msg, i) => (
        <MessageBlock key={i} message={msg} expanded={expanded} />
      ))}
      {streamingText !== undefined && streamingText !== "" && (
        <Box>
          {/* <Text>
            {COLORS.assistant(`${ICONS.dot} `)}
            {renderMarkdown(streamingText)}
          </Text> */}

          <StreamingText text={streamingText} />
        </Box>
      )}
    </Box>
  );
}

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

/**
 * Build a compact human-readable summary line for a turn, e.g.:
 *   "Thought for 4s, read 2 files, ran 1 command"
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildTurnSummaryText(
  thinkingDuration: number | undefined,
  tools: ToolSummaryItem[],
): string {
  const parts: string[] = [];

  if (thinkingDuration !== undefined && thinkingDuration >= 1) {
    parts.push(`Thought for ${String(Math.round(thinkingDuration))}s`);
  }

  if (tools.length > 0) {
    type Key = "read" | "wrote" | "edited" | "ran" | "globbed" | "searched" | "used";
    type Count = Record<Key, number>;
    type Label = Record<keyof Count, (n: number) => string>;

    // Categorize tools by type for a natural summary.
    const counts: Count = {
      read: 0,
      wrote: 0,
      edited: 0,
      ran: 0,
      globbed: 0,
      searched: 0,
      used: 0,
    };

    for (const t of tools) {
      const name = t.toolName;
      if (name === "ReadFile") {
        counts.read = counts.read + 1;
      } else if (name === "WriteFile") {
        counts.wrote = counts.wrote + 1;
      } else if (name === "EditFile") {
        counts.edited = counts.edited + 1;
      } else if (name === "Bash") {
        counts.ran = counts.ran + 1;
      } else if (name === "Glob") {
        counts.globbed = counts.globbed + 1;
      } else if (name === "Grep") {
        counts.searched = counts.searched + 1;
      } else {
        counts.used = counts.used + 1;
      }
    }

    const labels: Label = {
      read: (n) => `read ${String(n)} file${n > 1 ? "s" : ""}`,
      wrote: (n) => `wrote ${String(n)} file${n > 1 ? "s" : ""}`,
      edited: (n) => `edited ${String(n)} file${n > 1 ? "s" : ""}`,
      ran: (n) => `ran ${String(n)} command${n > 1 ? "s" : ""}`,
      globbed: (n) => `globbed ${String(n)} pattern${n > 1 ? "s" : ""}`,
      searched: (n) => `searched ${String(n)} pattern${n > 1 ? "s" : ""}`,
      used: (n) => `used ${String(n)} tool${n > 1 ? "s" : ""}`,
    } as const;

    for (const [key, count] of Object.entries<number>(counts)) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      parts.push(labels[key as Key](count));
    }
  }

  if (parts.length === 0) {
    return "";
  }
  return parts.join(", ");
}

interface TurnSummaryBlockProps {
  message: ChatMessage;
  expanded: boolean;
}

function TurnSummaryBlock(props: TurnSummaryBlockProps) {
  const { message, expanded } = props;
  const { /* content: thinkingText, */ thinkingDuration, toolSummary = [] } = message;
  if (!thinkingDuration && toolSummary.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={0}>
      {thinkingDuration !== undefined && thinkingDuration >= 1 && (
        <Text dimColor>
          {COLORS.thinking(`${ICONS.thinking} `)}Thought for {Math.round(thinkingDuration)}s
        </Text>
      )}
      {toolSummary.map((t, i) => {
        const icon = t.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
        const timeStr = t.elapsed ? ` (${t.elapsed.toFixed(1)}s)` : "";

        const isDiff = isDiffTool(t.toolName);
        const showOutput = isDiff || expanded;
        return (
          <Box key={i} flexDirection="column" marginBottom={0}>
            <Text>
              {icon} {COLORS.tool(t.toolName)}
              {t.argsSummary ? <Text dimColor> {t.argsSummary}</Text> : null}
              <Text dimColor>{timeStr}</Text>
            </Text>
            {showOutput && t.output ? (
              <Box paddingLeft={4}>
                {isDiff ? (
                  <DiffLines text={t.output} />
                ) : (
                  <Text dimColor>
                    {t.output.length > 500 ? t.output.slice(0, 500) + "..." : t.output}
                  </Text>
                )}
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
      const timeStr = message.elapsed !== undefined ? ` (${message.elapsed.toFixed(1)}s)` : "";

      const isDiff = isDiffTool(message.toolName ?? "");

      return (
        <Box flexDirection="column" marginBottom={0}>
          <Text>
            {icon} {COLORS.tool(message.toolName ?? "tool")}
            {message.argsSummary ? <Text dimColor> {message.argsSummary}</Text> : null}
            <Text dimColor>{timeStr}</Text>
          </Text>
          {message.content && (
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
          )}
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
