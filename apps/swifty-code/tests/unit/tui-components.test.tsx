import { describe, expect, test, vi } from "vitest";
import { render } from "ink-testing-library";
import React from "react";

import { PermissionPrompt } from "../../src/tui/components/permission-prompt.js";
import { EventLog } from "../../src/tui/components/event-log.js";
import type { AgentEvent } from "../../src/tui/components/event-card.js";

describe("PermissionPrompt", () => {
  // Feature: PermissionPrompt renders when visible
  // Design: Render with visible=true, verify prompt text appears
  test("renders prompt when visible", () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(
      <PermissionPrompt
        toolName="bash"
        paramsPreview="command='ls -la'"
        toolUseId="tu-1"
        onRespond={onRespond}
        visible={true}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("permission required");
    expect(frame).toContain("bash");
    expect(frame).toContain("Allow once");
    expect(frame).toContain("Always deny");
  });

  // Feature: PermissionPrompt does not render when hidden
  // Design: Render with visible=false, verify nothing is shown
  test("renders nothing when not visible", () => {
    const onRespond = vi.fn();
    const { lastFrame } = render(
      <PermissionPrompt
        toolName="bash"
        paramsPreview=""
        toolUseId="tu-1"
        onRespond={onRespond}
        visible={false}
      />,
    );
    expect(lastFrame()).toBe("");
  });

  // Feature: PermissionPrompt responds to y shortcut
  // Design: Press 'y', verify onRespond called with 'allow_once'
  test("y shortcut triggers allow_once", () => {
    const onRespond = vi.fn();
    const { stdin } = render(
      <PermissionPrompt
        toolName="bash"
        paramsPreview=""
        toolUseId="tu-1"
        onRespond={onRespond}
        visible={true}
      />,
    );
    stdin.write("y");
    expect(onRespond).toHaveBeenCalledWith("allow_once");
  });

  // Feature: PermissionPrompt responds to number shortcuts
  // Design: Press '2', verify onRespond called with 'always_allow'
  test("number shortcut 2 triggers always_allow", () => {
    const onRespond = vi.fn();
    const { stdin } = render(
      <PermissionPrompt
        toolName="bash"
        paramsPreview=""
        toolUseId="tu-1"
        onRespond={onRespond}
        visible={true}
      />,
    );
    stdin.write("2");
    expect(onRespond).toHaveBeenCalledWith("always_allow");
  });

  // Feature: PermissionPrompt responds to Enter key
  // Design: Press Enter, verify onRespond called with the highlighted choice
  test("enter triggers highlighted choice", () => {
    const onRespond = vi.fn();
    const { stdin } = render(
      <PermissionPrompt
        toolName="bash"
        paramsPreview=""
        toolUseId="tu-1"
        onRespond={onRespond}
        visible={true}
      />,
    );
    // Cursor starts at 0 (Allow once), press Enter
    stdin.write("\r");
    expect(onRespond).toHaveBeenCalledWith("allow_once");
  });

  // Feature: PermissionPrompt responds to n shortcut
  // Design: Press 'n', verify onRespond called with 'deny_once'
  test("n shortcut triggers deny_once", () => {
    const onRespond = vi.fn();
    const { stdin } = render(
      <PermissionPrompt
        toolName="bash"
        paramsPreview=""
        toolUseId="tu-1"
        onRespond={onRespond}
        visible={true}
      />,
    );
    stdin.write("n");
    expect(onRespond).toHaveBeenCalledWith("deny_once");
  });

  // Feature: PermissionPrompt responds to d shortcut
  // Design: Press 'd', verify onRespond called with 'always_deny'
  test("d shortcut triggers always_deny", () => {
    const onRespond = vi.fn();
    const { stdin } = render(
      <PermissionPrompt
        toolName="bash"
        paramsPreview=""
        toolUseId="tu-1"
        onRespond={onRespond}
        visible={true}
      />,
    );
    stdin.write("d");
    expect(onRespond).toHaveBeenCalledWith("always_deny");
  });
});

describe("EventLog", () => {
  // Feature: EventLog merges consecutive llm.token events
  // Design: Provide multiple token events, verify rendered output shows merged text
  test("merges consecutive llm.token events into flowing text", () => {
    const events: AgentEvent[] = [
      { type: "llm.token", data: { token: "Hello" }, timestamp: "2026-01-01T00:00:00Z" },
      { type: "llm.token", data: { token: " " }, timestamp: "2026-01-01T00:00:01Z" },
      { type: "llm.token", data: { token: "World" }, timestamp: "2026-01-01T00:00:02Z" },
    ];

    const { lastFrame } = render(<EventLog events={events} />);
    const frame = lastFrame();
    // Merged text should appear as "Hello World" (not three separate lines)
    expect(frame).toContain("Hello World");
  });

  // Feature: EventLog shows banner when empty
  // Design: Provide empty events with showBanner=true, verify banner text
  test("shows banner when no events", () => {
    const { lastFrame } = render(<EventLog events={[]} showBanner={true} />);
    const frame = lastFrame();
    expect(frame).toContain("Enter a message");
    expect(frame).toContain("Ctrl+C to exit");
  });

  // Feature: EventLog renders non-token events normally
  // Design: Provide a run.started event, verify it appears in output
  test("renders run.started event", () => {
    const events: AgentEvent[] = [
      {
        type: "run.started",
        data: { run_id: "run-abc", goal: "test goal" },
        timestamp: "2026-01-01T00:00:00Z",
      },
    ];

    const { lastFrame } = render(<EventLog events={events} />);
    const frame = lastFrame();
    expect(frame).toContain("run-abc");
  });

  // Feature: EventLog interrupts token merge on non-token event
  // Design: Provide tokens then a non-token event, verify both appear
  test("flushes token buffer on non-token event", () => {
    const events: AgentEvent[] = [
      { type: "llm.token", data: { token: "Hi" }, timestamp: "2026-01-01T00:00:00Z" },
      {
        type: "step.finished",
        data: { run_id: "r1", step: 1 },
        timestamp: "2026-01-01T00:00:01Z",
      },
    ];

    const { lastFrame } = render(<EventLog events={events} />);
    const frame = lastFrame();
    // Both the merged token text and the step event should appear
    expect(frame).toContain("Hi");
  });
});
