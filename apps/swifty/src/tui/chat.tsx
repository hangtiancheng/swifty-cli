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
import { Marked } from "marked";
import React, { useRef } from "react";

import { createChildLogger } from "../logger/logger.js";
import { isDiffTool } from "../tools/is-diff-tool.js";

import { DiffLines } from "./diff-render.js";
import { THEME } from "./styles.js";
import { formatToolOutputPreview } from "./tool-preview.js";

const log = createChildLogger({ module: "tui" });

chalk.level = 3;

const isPromise = (value: unknown): value is Promise<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

function stripIncompleteFence(text: string): string {
  return text.replace(/\n`{1,2}$/u, "");
}

function renderMarkdown(
  text: string,
  width = Math.max(1, (process.stdout.columns || 80) - 2),
): string {
  const markdown = new Marked({ breaks: false, gfm: true });
  markdown.use(
    markedTerminal(
      {
        blockquote: (value) =>
          value
            .trimEnd()
            .split("\n")
            .map(
              (line) =>
                `${chalk.hex(THEME.mdQuoteBorder)("│")} ${chalk.italic.hex(THEME.mdQuote)(line.trimStart())}`,
            )
            .join("\n"),
        code: chalk.hex(THEME.mdCodeBlock),
        codespan: chalk.hex(THEME.mdCode),
        del: chalk.strikethrough.hex(THEME.dim),
        em: chalk.italic,
        firstHeading: chalk.bold.underline.hex(THEME.mdHeading),
        heading: chalk.bold.hex(THEME.mdHeading),
        hr: chalk.hex(THEME.mdHr),
        href: chalk.underline.hex(THEME.mdLinkUrl),
        link: chalk.hex(THEME.mdLink),
        listitem: chalk.hex(THEME.text),
        paragraph: chalk.hex(THEME.text),
        reflowText: true,
        sanitize: true,
        showSectionPrefix: false,
        strong: chalk.bold,
        tab: 3,
        table: chalk.hex(THEME.text),
        text: chalk.hex(THEME.text),
        width,
      },
      {
        language: "plaintext",
        theme: {
          addition: chalk.hex(THEME.toolDiffAdded),
          attr: chalk.hex(THEME.syntaxVariable),
          built_in: chalk.hex(THEME.syntaxType),
          class: chalk.hex(THEME.syntaxType),
          comment: chalk.hex(THEME.syntaxComment),
          default: chalk.hex(THEME.syntaxOperator),
          deletion: chalk.hex(THEME.toolDiffRemoved),
          function: chalk.hex(THEME.syntaxFunction),
          keyword: chalk.hex(THEME.syntaxKeyword),
          literal: chalk.hex(THEME.syntaxNumber),
          name: chalk.hex(THEME.syntaxFunction),
          number: chalk.hex(THEME.syntaxNumber),
          params: chalk.hex(THEME.syntaxVariable),
          string: chalk.hex(THEME.syntaxString),
          title: chalk.hex(THEME.syntaxFunction),
          type: chalk.hex(THEME.syntaxType),
          variable: chalk.hex(THEME.syntaxVariable),
        },
      },
    ),
  );

  try {
    const result = markdown.parse(stripIncompleteFence(text));
    return isPromise(result) ? text : result.trimEnd();
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
  thinkingText?: string;
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
  const stableRef = useRef({ text: "", rendered: "", width: 0 });
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;
  const contentWidth = Math.max(1, cols - 2);
  if (stableRef.current.width !== contentWidth) {
    stableRef.current = { text: "", rendered: "", width: contentWidth };
  }
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
      rendered: renderMarkdown(stableText, contentWidth),
      width: contentWidth,
    };
  }

  const unstableRendered = unstableText ? renderMarkdown(unstableText, contentWidth) : "";
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

  return <Text>{visibleText}</Text>;
}

export const ChatView = React.memo(function (props: ChatViewProps) {
  const { messages, streamingText, thinkingText, expanded = false } = props;
  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => (
        <MessageBlock key={i} message={msg} expanded={expanded} />
      ))}
      {thinkingText ? (
        <Box marginTop={1} paddingLeft={1} paddingRight={1}>
          <Text color={THEME.thinking} italic>
            {expanded ? thinkingText.trimEnd() : clampOutput(thinkingText)}
          </Text>
        </Box>
      ) : null}
      {streamingText !== undefined && streamingText !== "" && (
        <Box marginTop={1} paddingLeft={1}>
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
  return <MessageBlock message={message} expanded={expanded} />;
}

interface TurnSummaryBlockProps {
  message: ChatMessage;
  expanded: boolean;
}

function clampOutput(text: string): string {
  return text.length > 200
    ? text.slice(0, 200) + `\n… ${String(text.length - 200)} chars (ctrl+o to expand)`
    : text;
}

function TurnSummaryBlock(props: TurnSummaryBlockProps) {
  const { message, expanded } = props;
  const { stdout } = useStdout();
  const width = Math.max(1, stdout.columns || 80);
  const { content: thinkingText, thinkingDuration, toolSummary = [] } = message;
  if (!thinkingText && !thinkingDuration && toolSummary.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" marginBottom={0}>
      {(thinkingText !== "" || (thinkingDuration !== undefined && thinkingDuration >= 1)) && (
        <Text color={THEME.thinking} italic>
          Thinking for {Math.max(1, Math.round(thinkingDuration ?? 0))}s
        </Text>
      )}
      {thinkingText !== "" && (
        <Box paddingLeft={2}>
          <Text color={THEME.thinking} italic>
            {expanded ? thinkingText.trimEnd() : clampOutput(thinkingText)}
          </Text>
        </Box>
      )}
      {toolSummary.map((t, i) => {
        // Summaries rebuilt from a resumed session carry no timing (elapsed 0) — omit the suffix.
        const timeStr = t.elapsed > 0 ? ` (${t.elapsed.toFixed(1)}s)` : "";

        const isDiff = isDiffTool(t.toolName);
        const output = t.output
          ? expanded
            ? t.output.trimEnd()
            : formatToolOutputPreview(t.toolName, t.output)
          : "";
        return (
          <Box
            key={i}
            backgroundColor={t.isError ? THEME.toolErrorBg : THEME.toolSuccessBg}
            flexDirection="column"
            marginTop={1}
            paddingLeft={1}
            paddingRight={1}
            paddingY={1}
            width={width}
          >
            <Text>
              <Text bold color={THEME.text}>
                {t.toolName}
              </Text>
              {t.argsSummary ? <Text color={THEME.accent}> {t.argsSummary}</Text> : null}
              <Text color={THEME.dim}>{timeStr}</Text>
            </Text>
            {output ? (
              <Box paddingLeft={2}>
                {isDiff ? <DiffLines text={output} /> : <Text color={THEME.muted}>{output}</Text>}
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
  const { stdout } = useStdout();
  const width = Math.max(1, stdout.columns || 80);

  switch (message.role) {
    case "user": {
      return (
        <Box
          backgroundColor={THEME.userMessageBg}
          marginTop={1}
          paddingLeft={1}
          paddingRight={1}
          paddingY={1}
          width={width}
        >
          <Text color={THEME.text}>{message.content}</Text>
        </Box>
      );
    }

    case "assistant": {
      return (
        <Box marginTop={1} paddingLeft={1} paddingRight={1}>
          <Text>{renderMarkdown(message.content)}</Text>
        </Box>
      );
    }

    case "turn_summary": {
      return <TurnSummaryBlock message={message} expanded={expanded} />;
    }

    case "system": {
      const isError = /^(?:Error:|Hook error:)/u.test(message.content);
      const isWarning = /^(?:Warning:|Hook warning:|↻)/u.test(message.content);
      const isCompaction = /^(?:⊙ |Compact:)/u.test(message.content);
      if (isCompaction) {
        return (
          <Box
            backgroundColor={THEME.customMessageBg}
            flexDirection="column"
            marginTop={1}
            paddingLeft={1}
            paddingRight={1}
            paddingY={1}
            width={width}
          >
            <Text bold color={THEME.customMessageLabel}>
              [compaction]
            </Text>
            <Text color={THEME.muted}>{message.content.replace(/^(?:⊙ |Compact:\s*)/u, "")}</Text>
          </Box>
        );
      }
      return (
        <Box marginTop={1} paddingLeft={1} paddingRight={1}>
          <Text color={isError ? THEME.error : isWarning ? THEME.warning : THEME.muted}>
            {message.content.replace(/^↻\s*/u, "Retrying: ")}
          </Text>
        </Box>
      );
    }
    default: {
      return null;
    }
  }
}
