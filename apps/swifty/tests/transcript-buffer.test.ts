import { describe, expect, it } from "vitest";

import { toDisplayPreview, TOOL_RESULT_PREVIEW_CHARS } from "../src/tool-result/budget.js";
import {
  MAX_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_MESSAGES,
  TranscriptBuffer,
} from "../src/tui/transcript-buffer.js";

describe("TranscriptBuffer", () => {
  it("bounds long-running transcript retention by count and characters", () => {
    const buffer = new TranscriptBuffer();

    for (let index = 0; index < 10_000; index++) {
      buffer.append([{ role: "assistant", content: `${String(index)}:${"x".repeat(1000)}` }]);
    }

    const retained = buffer.snapshot();
    expect(retained.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_MESSAGES);
    expect(buffer.retainedChars()).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    expect(retained.at(-1)?.content).toContain("9999:");
  });

  it("truncates only the retained replay copy of an oversized message", () => {
    const source = {
      role: "turn_summary" as const,
      content: "thinking",
      toolSummary: [
        {
          toolName: "BigTool",
          argsSummary: "args",
          output: "z".repeat(MAX_TRANSCRIPT_CHARS * 2),
          isError: false,
          elapsed: 1,
        },
      ],
    };
    const buffer = new TranscriptBuffer();

    buffer.append([source]);

    expect(source.toolSummary[0]?.output.length).toBe(MAX_TRANSCRIPT_CHARS * 2);
    expect(buffer.retainedChars()).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    expect(buffer.snapshot()[0]?.toolSummary?.[0]?.output).toContain("truncated for replay");
  });

  it("bounds tool output before it enters TUI state", () => {
    const original = "o".repeat(TOOL_RESULT_PREVIEW_CHARS + 500);
    const preview = toDisplayPreview(original);

    expect(preview).not.toBe(original);
    expect(preview).toContain("500 chars omitted from transcript");
    expect(preview.length).toBeLessThan(original.length);
  });
});
