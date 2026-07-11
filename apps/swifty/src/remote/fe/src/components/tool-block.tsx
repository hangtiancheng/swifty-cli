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
