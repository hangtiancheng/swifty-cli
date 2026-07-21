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

import { Text, Box } from "ink";
import type { TeammateUIState } from "../teams/progress.js";
import { summarizeActivities, formatTokens } from "../teams/progress.js";

interface TeammateSpinnerLineProps {
  state: TeammateUIState;
  isLast: boolean;
  isSelected?: boolean;
}

export function TeammateSpinnerLine(props: TeammateSpinnerLineProps) {
  const { state, isLast, isSelected } = props;
  const pointer = isSelected ? "> " : "  ";
  let connector: string;

  if (isSelected && isLast) {
    connector = "╘═ ";
  } else if (isSelected) {
    connector = "╞═ ";
  } else if (isLast) {
    connector = "└─ ";
  } else {
    connector = "├─ ";
  }

  const { status, progress, spinnerVerb } = state;

  let statusNode: React.ReactNode;
  switch (status) {
    case "idle": {
      statusNode = <Text dimColor>idle</Text>;
      break;
    }
    case "completed": {
      statusNode = <Text color="green">completed</Text>;
      break;
    }
    case "failed": {
      statusNode = <Text color="red">failed</Text>;
      break;
    }
    case "stopped": {
      statusNode = <Text color="yellow">stopped</Text>;
      break;
    }
    case "running": {
      const summary = summarizeActivities(progress.recentActivities);
      const label = summary || spinnerVerb;
      statusNode = (
        <Text dimColor>
          {label}
          {summary ? "..." : ""}
        </Text>
      );
      break;
    }
  }

  const stats = ` · ${String(progress.toolUseCount)} tools · ${formatTokens(progress.tokenCount)} tokens`;

  return (
    <Box>
      <Text>
        {pointer}
        <Text dimColor>{connector}</Text>
        <Text color="cyan">@{state.name}</Text>
        {": "}
        {statusNode}
        <Text dimColor>{stats}</Text>
      </Text>
    </Box>
  );
}
