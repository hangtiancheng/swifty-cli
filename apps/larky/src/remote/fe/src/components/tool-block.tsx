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

import { argsPreview, formatArgs, truncateOutput } from "../lib/format";
import type { ToolItem } from "../types";
import { Collapsible } from "./collapsible";

interface ToolBlockProps {
  item: ToolItem;
}

const STATUS_META: Record<ToolItem["status"], { label: string; className: string }> = {
  running: { label: "⏳ running...", className: "text-yellow" },
  ok: { label: "✓", className: "text-green" },
  err: { label: "✗", className: "text-red" },
};

export function ToolBlock({ item }: ToolBlockProps) {
  const meta = STATUS_META[item.status];
  const statusText =
    item.status === "running" ? meta.label : `${meta.label} ${item.elapsed.toFixed(1)}s`;
  const preview = argsPreview(item.args);
  const argsStr = formatArgs(item.args);
  const output = item.output ? truncateOutput(item.output) : "";

  return (
    <Collapsible
      header={
        <>
          <span className="font-semibold text-blue">{item.toolName}</span>
          {preview && (
            <span className="ml-1 max-w-[500px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-dim">
              {preview}
            </span>
          )}
          <span className={`ml-auto text-xs ${meta.className}`}>{statusText}</span>
        </>
      }
    >
      {argsStr && (
        <div className="mb-2 text-blue">
          Args:
          {"\n"}
          {argsStr}
        </div>
      )}
      {output && <div className="whitespace-pre-wrap text-dim">{output}</div>}
    </Collapsible>
  );
}
