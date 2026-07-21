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

import { Box, Text } from "ink";
import { COLORS, ICONS } from "./styles.js";
import { strArg } from "@/utils/index.js";
import { DiffLines } from "./diff-render.js";
import { isDiffTool } from "./is-diff-tool.js";

export interface ToolBlockInfo {
  toolName: string;
  args: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  elapsed?: number;
  loading?: boolean;
}

interface ToolBlockProps {
  tool: ToolBlockInfo;
}

interface ToolDisplayProps {
  tools: ToolBlockInfo[];
}

function ToolBlock(props: ToolBlockProps) {
  const { tool } = props;
  const argSummary = formatArgs(tool.args);
  if (tool.loading) {
    return (
      <Box>
        <Text>
          <Text color="magenta">●</Text> {COLORS.tool(tool.toolName)}
          {argSummary ? <Text dimColor>{argSummary}</Text> : null}
        </Text>
      </Box>
    );
  }

  const icon = tool.isError ? COLORS.error(ICONS.error) : COLORS.success(ICONS.success);
  const timeStr = tool.elapsed !== undefined ? `(${tool.elapsed.toFixed(1)}s)` : "";

  return (
    <Box flexDirection="column">
      <Text>
        {icon} {COLORS.tool(tool.toolName)}
        {argSummary ? <Text dimColor> {argSummary}</Text> : null}
        <Text dimColor>{timeStr}</Text>
      </Text>
      {tool.output && (
        <Box paddingLeft={2} marginBottom={0}>
          {isDiffTool(tool.toolName) ? (
            <DiffLines text={tool.output} />
          ) : (
            <Text dimColor>
              {tool.output.length > 500 ? tool.output.slice(0, 500) + "…" : tool.output}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

export function ToolDisplay(props: ToolDisplayProps) {
  const { tools } = props;
  if (tools.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {tools.map((tool, idx) => (
        <ToolBlock key={idx} tool={tool} />
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
