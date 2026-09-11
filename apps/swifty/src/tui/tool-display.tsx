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

import { Box, Text, useStdout } from "ink";

import { isDiffTool } from "../tools/is-diff-tool.js";

import { DiffLines } from "./diff-render.js";
import { THEME } from "./styles.js";
import { formatToolOutputPreview } from "./tool-preview.js";

import { strArg } from "@/utils/index.js";

export interface ToolBlockInfo {
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  elapsed?: number;
  loading?: boolean;
}

interface ToolBlockProps {
  tool: ToolBlockInfo;
  expanded?: boolean;
}

interface ToolDisplayProps {
  tools: ToolBlockInfo[];
  expanded?: boolean;
}

export function ToolBlock(props: ToolBlockProps) {
  const { tool, expanded = false } = props;
  const { stdout } = useStdout();
  const width = Math.max(1, stdout.columns || 80);
  const argSummary = formatArgs(tool.args);
  const backgroundColor = tool.loading
    ? THEME.toolPendingBg
    : tool.isError
      ? THEME.toolErrorBg
      : THEME.toolSuccessBg;
  const time = tool.elapsed === undefined ? "" : ` (${tool.elapsed.toFixed(1)}s)`;
  const output = tool.output
    ? expanded
      ? tool.output.trimEnd()
      : formatToolOutputPreview(tool.toolName, tool.output)
    : "";

  return (
    <Box
      backgroundColor={backgroundColor}
      flexDirection="column"
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
      paddingY={1}
      width={width}
    >
      <Text>
        <Text bold color={THEME.text}>
          {tool.toolName}
        </Text>
        {argSummary ? <Text color={THEME.accent}> {argSummary}</Text> : null}
        <Text color={THEME.dim}>{time}</Text>
      </Text>
      {output ? (
        <Box paddingLeft={2}>
          {isDiffTool(tool.toolName) ? (
            <DiffLines text={output} />
          ) : (
            <Text color={THEME.muted}>{output}</Text>
          )}
        </Box>
      ) : null}
    </Box>
  );
}

export function ToolDisplay(props: ToolDisplayProps) {
  const { tools, expanded = false } = props;
  if (tools.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column">
      {tools.map((tool) => (
        <ToolBlock key={tool.toolId} tool={tool} expanded={expanded} />
      ))}
    </Box>
  );
}

// export default ToolDisplay;

function formatArgs(args: Record<string, unknown>): string {
  if (args.command) {
    return truncate(strArg(args, "command"), 80);
  }
  if (args.file_path) {
    return truncate(strArg(args, "file_path"), 80);
  }
  if (args.pattern) {
    return truncate(strArg(args, "pattern"), 80);
  }
  return "";
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
