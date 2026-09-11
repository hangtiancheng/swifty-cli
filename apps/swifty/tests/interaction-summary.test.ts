import { describe, expect, it } from "vitest";

import { formatInteractionSummary } from "@/bootstrap/interaction-summary.js";

describe("interaction summary", () => {
  it("prints session, tool, and timing metrics with a resume command", () => {
    const output = formatInteractionSummary(
      {
        agentActiveMs: 10_000,
        failedToolCalls: 1,
        sessionId: "session-123",
        startedAt: 1_000,
        successfulToolCalls: 3,
        toolTimeMs: 4_000,
      },
      16_000,
    );

    expect(output).toContain("Interaction Summary");
    expect(output).toContain("Session ID:                 session-123");
    expect(output).toContain("Tool Calls:                 4 ( ✓ 3 x 1 )");
    expect(output).toContain("Success Rate:               75.0%");
    expect(output).toContain("Agent Active:               10s");
    expect(output).toContain("API Time:               6s (60.0%)");
    expect(output).toContain("Tool Time:              4s (40.0%)");
    expect(output).toContain("swifty --resume session-123");
  });

  it("prints zero rates when no tools or agent work occurred", () => {
    const output = formatInteractionSummary(
      {
        agentActiveMs: 0,
        failedToolCalls: 0,
        sessionId: "empty",
        startedAt: 1_000,
        successfulToolCalls: 0,
        toolTimeMs: 0,
      },
      1_000,
    );

    expect(output).toContain("Success Rate:               0.0%");
    expect(output).toContain("API Time:               0s (0.0%)");
    expect(output).toContain("Tool Time:              0s (0.0%)");
  });
});
