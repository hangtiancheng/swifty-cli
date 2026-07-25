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

// Main TUI application: daemon client + event-driven rendering inside an
// alt-screen scroll viewport (the app manages scrolling itself; there is no
// terminal scrollback region under the alternate screen buffer).
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput, useStdout, measureElement, type DOMElement } from "ink";

import { COLORS, ICONS } from "./styles.js";
import { contextBarFill, contextBarColor } from "./theme.js";
import { ChatView, type ChatMessage } from "./chat.js";
import { ToolDisplay, type ToolBlockInfo } from "./tool-display.js";
import Spinner from "./spinner.js";
import { InputBox, type Cmd } from "./input.js";
import { PermissionDialog, type PermissionAction } from "./permission-dialog.js";
import { enableMouseTracking, disableMouseTracking, parseWheel } from "./mouse.js";
import { randomCompletionVerb } from "./verbs.js";

import type { SocketClient } from "../core/transport/socket-client.js";
import type { LarkyConfig } from "../core/config.js";
import { SkillLoader } from "../core/skills/loader.js";
import { version } from "../version.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface AppProps {
  readonly _config: LarkyConfig;
  readonly client: SocketClient;
}

// Build command list for slash completion: builtin + skills
function buildCommands(): Cmd[] {
  const loader = new SkillLoader();
  const skills = loader.listAllSkills();
  const cmds: Cmd[] = [
    {
      name: "compact",
      description: "Compress conversation context",
      aliases: [],
    },
  ];
  for (const s of skills) {
    cmds.push({ name: s.name, description: s.description, aliases: [] });
  }
  return cmds;
}

// History persistence (local file, no core dependency)
const HISTORY_FILE = `${process.env["HOME"] ?? ""}/.larky/tui-history.json`;

function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      const raw = readFileSync(HISTORY_FILE, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === "string");
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function saveHistory(entry: string): void {
  try {
    const dir = dirname(HISTORY_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const existing = loadHistory();
    const next = [...existing, entry].slice(-200);
    writeFileSync(HISTORY_FILE, JSON.stringify(next), "utf-8");
  } catch {
    // ignore
  }
}

function str(data: Record<string, unknown>, key: string): string {
  const val = data[key];
  return typeof val === "string" ? val : "";
}

function num(data: Record<string, unknown>, key: string): number {
  const val = data[key];
  return typeof val === "number" ? val : 0;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

export function App({ _config, client }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeTools, setActiveTools] = useState<ToolBlockInfo[]>([]);
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [contextPercent, setContextPercent] = useState(0);
  const [completionMark, setCompletionMark] = useState<string | null>(null);
  // Pending permission requests as a FIFO queue: multiple permission.requested
  // events no longer overwrite each other; the head is displayed first.
  const [permissionQueue, setPermissionQueue] = useState<
    {
      toolName: string;
      argsSummary: string;
      toolUseId: string;
    }[]
  >([]);
  const permissionRequest = permissionQueue[0] ?? null;
  const [permMode, setPermMode] = useState<string>("default");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [ctrlCHint, setCtrlCHint] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>(loadHistory);
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState("connecting...");
  const streamingTextRef = useRef("");
  const streamThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const lastRunIdRef = useRef<string | null>(null);
  const subagentStartTimes = useRef<Map<string, number>>(new Map());
  // tool_use_id -> {toolName, preview} recorded at permission.requested so the
  // granted/denied history line can include tool name + param preview.
  const permissionInfoRef = useRef<Map<string, { toolName: string; preview: string }>>(new Map());

  const commandsRef = useRef<Cmd[]>(buildCommands());

  // Ctrl+C double-tap exit logic (Swifty-style)
  const ctrlCCountRef = useRef(0);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ctrl+O toggles tool expansion
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setToolsExpanded((e) => !e);
    }
  });

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (isRunning) {
        // daemon-side run cannot be interrupted from TUI; hint to wait
        setCtrlCHint(true);
        if (ctrlCTimerRef.current) {
          clearTimeout(ctrlCTimerRef.current);
        }
        ctrlCTimerRef.current = setTimeout(() => {
          setCtrlCHint(false);
        }, 2000);
        return;
      }
      ctrlCCountRef.current += 1;
      if (ctrlCCountRef.current >= 2) {
        void closeAndExit();
        return;
      }
      setCtrlCHint(true);
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
      }
      ctrlCTimerRef.current = setTimeout(() => {
        ctrlCCountRef.current = 0;
        setCtrlCHint(false);
      }, 2000);
    }
  });

  const closeAndExit = useCallback(async () => {
    if (sessionIdRef.current) {
      try {
        await client.sendCommand("session.close", {
          session_id: sessionIdRef.current,
        });
      } catch {
        // best effort
      }
    }
    client.close();
    exit();
  }, [client, exit]);

  // Register event handler ONCE (persists across reconnections)
  useEffect(() => {
    client.onEvent((event) => {
      const eventType = str(event, "type");

      // Flush streaming text helper
      const flushStream = (): void => {
        if (streamThrottleRef.current) {
          clearTimeout(streamThrottleRef.current);
          streamThrottleRef.current = null;
        }
        const fullText = streamingTextRef.current;
        if (fullText) {
          setMessages((prev) => [...prev, { role: "assistant" as const, content: fullText }]);
        }
        streamingTextRef.current = "";
        setStreamingText("");
      };

      switch (eventType) {
        case "run.started": {
          setCompletionMark(null);
          setIsRunning(true);
          setActiveTools([]);
          setTotalTokens(0);
          // Clear any residual streaming text (e.g. resume after reconnect)
          if (streamThrottleRef.current) {
            clearTimeout(streamThrottleRef.current);
            streamThrottleRef.current = null;
          }
          streamingTextRef.current = "";
          setStreamingText("");
          const runId = str(event, "run_id");
          if (runId) {
            lastRunIdRef.current = runId;
          }
          const goal = str(event, "goal");
          if (goal) {
            const preview = goal.length > 80 ? goal.slice(0, 80) + "…" : goal;
            setMessages((prev) => [...prev, { role: "system", content: `goal: ${preview}` }]);
          }
          break;
        }

        case "run.finished": {
          flushStream();
          setIsRunning(false);
          setActiveTools([]);
          setContextPercent(0);
          const elapsed = num(event, "elapsed_ms");
          if (elapsed > 0) {
            setCompletionMark(
              `✻ ${randomCompletionVerb()} for ${String(Math.round(elapsed / 1000))}s`,
            );
          } else {
            setCompletionMark(`✻ ${randomCompletionVerb()}`);
          }
          break;
        }

        case "step.started": {
          const step = num(event, "step");
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `── step ${String(step)} ──` },
          ]);
          break;
        }

        case "llm.token": {
          const token = str(event, "token");
          streamingTextRef.current += token;
          streamThrottleRef.current ??= setTimeout(() => {
            setStreamingText(streamingTextRef.current);
            streamThrottleRef.current = null;
          }, 50);
          break;
        }

        case "llm.model_selected": {
          const model = str(event, "model");
          setMessages((prev) => [...prev, { role: "system", content: `model: ${model}` }]);
          break;
        }

        case "llm.usage": {
          const inTok = num(event, "input_tokens");
          const outTok = num(event, "output_tokens");
          const ctxPct = num(event, "context_percent");
          setInputTokens((t) => t + inTok);
          setOutputTokens((t) => t + outTok);
          setTotalTokens((t) => t + inTok + outTok);
          setContextPercent(ctxPct);
          break;
        }

        case "session.message_received": {
          const content = str(event, "content");
          // Deduplicate: handleSubmit already added the user message locally
          // for immediate feedback. Skip if the last message matches.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "user" && last?.content === content) {
              return prev;
            }
            return [...prev, { role: "user" as const, content }];
          });
          break;
        }

        case "tool.call_started": {
          const toolName = str(event, "tool_name");
          const toolUseId = str(event, "tool_use_id");
          const paramsRaw = event["params"];
          const params = isRecord(paramsRaw) ? paramsRaw : {};
          setActiveTools((prev) => [...prev, { toolName, toolUseId, args: params, loading: true }]);
          break;
        }

        case "tool.call_finished": {
          const toolName = str(event, "tool_name");
          const toolUseId = str(event, "tool_use_id");
          const output = str(event, "output");
          const elapsedMs = num(event, "elapsed_ms");
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolUseId === toolUseId ? { ...t, output, elapsed: elapsedMs, loading: false } : t,
            ),
          );
          // Tool completed: drop any stale pending permission request for it
          setPermissionQueue((prev) => prev.filter((r) => r.toolUseId !== toolUseId));
          permissionInfoRef.current.delete(toolUseId);
          // Also commit as a tool_result message
          setMessages((prev) => [
            ...prev,
            {
              role: "tool_result",
              toolName,
              content: output,
              elapsed: elapsedMs,
            },
          ]);
          break;
        }

        case "tool.call_failed": {
          const toolName = str(event, "tool_name");
          const toolUseId = str(event, "tool_use_id");
          const errorMessage = str(event, "error_message");
          const elapsedMs = num(event, "elapsed_ms");
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolUseId === toolUseId
                ? {
                    ...t,
                    output: errorMessage,
                    isError: true,
                    elapsed: elapsedMs,
                    loading: false,
                  }
                : t,
            ),
          );
          // Tool failed (possibly permission timeout): drop stale pending request
          setPermissionQueue((prev) => prev.filter((r) => r.toolUseId !== toolUseId));
          permissionInfoRef.current.delete(toolUseId);
          setMessages((prev) => [
            ...prev,
            {
              role: "tool_result",
              toolName,
              content: errorMessage,
              isError: true,
              elapsed: elapsedMs,
            },
          ]);
          break;
        }

        case "permission.requested": {
          const toolName = str(event, "tool_name");
          const paramsPreview = str(event, "param_preview");
          const toolUseId = str(event, "tool_use_id");
          permissionInfoRef.current.set(toolUseId, {
            toolName,
            preview: paramsPreview,
          });
          setPermissionQueue((prev) =>
            prev.some((r) => r.toolUseId === toolUseId)
              ? prev
              : [...prev, { toolName, argsSummary: paramsPreview, toolUseId }],
          );
          break;
        }

        case "permission.granted":
        case "permission.denied": {
          const decision = str(event, "decision");
          const toolUseId = str(event, "tool_use_id");
          const granted = eventType === "permission.granted";
          // Remove from queue (covers daemon-side timeouts / external responses)
          setPermissionQueue((prev) => prev.filter((r) => r.toolUseId !== toolUseId));
          const info = permissionInfoRef.current.get(toolUseId);
          permissionInfoRef.current.delete(toolUseId);
          const preview = info?.preview
            ? info.preview.length > 80
              ? info.preview.slice(0, 80) + "…"
              : info.preview
            : "";
          const context = info ? ` ${info.toolName}${preview ? ` \`${preview}\`` : ""}` : "";
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `${granted ? "✓" : "✗"} permission${context} → ${decision}`,
            },
          ]);
          break;
        }

        case "session.waiting_for_input": {
          flushStream();
          setIsRunning(false);
          setActiveTools([]);
          setPermissionQueue([]);
          break;
        }

        case "session.created": {
          break;
        }

        case "session.closed": {
          setIsRunning(false);
          break;
        }

        case "context.compacted": {
          setContextPercent(0);
          const originalTokens = num(event, "original_tokens");
          const summaryTokens = num(event, "summary_tokens");
          const saved = Math.max(0, originalTokens - summaryTokens);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `↻ compacted (saved ${String(saved)} tokens: ${String(originalTokens)} → ${String(summaryTokens)})`,
            },
          ]);
          break;
        }

        case "subagent.started": {
          const runId = str(event, "run_id");
          const ts = Date.parse(str(event, "timestamp"));
          if (runId) {
            subagentStartTimes.current.set(runId, Number.isNaN(ts) ? Date.now() : ts);
          }
          const description = str(event, "description");
          const shortId = runId ? ` [${runId.slice(0, 8)}]` : "";
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `↳ subagent${shortId}: ${description}` },
          ]);
          break;
        }

        case "subagent.finished": {
          const runId = str(event, "run_id");
          const status = str(event, "status");
          const startTime = subagentStartTimes.current.get(runId);
          let durationStr = "";
          if (startTime !== undefined) {
            subagentStartTimes.current.delete(runId);
            const endTs = Date.parse(str(event, "timestamp"));
            const elapsedMs = (Number.isNaN(endTs) ? Date.now() : endTs) - startTime;
            if (elapsedMs >= 0) {
              durationStr = ` (${(elapsedMs / 1000).toFixed(1)}s)`;
            }
          }
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `↳ subagent done: ${status}${durationStr}`,
            },
          ]);
          break;
        }

        case "skill.invoked": {
          const skillName = str(event, "skill_name");
          const args = str(event, "arguments");
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `→ skill: /${skillName} ${args}` },
          ]);
          break;
        }

        case "log.line": {
          const level = (str(event, "level") || "INFO").toUpperCase();
          const message = str(event, "message");
          // DEBUG stays dropped for noise reduction; INFO and above are
          // rendered (system role renders dim, matching the old TUI).
          if (level !== "DEBUG") {
            setMessages((prev) => [...prev, { role: "system", content: `[${level}] ${message}` }]);
          }
          break;
        }

        default: {
          // Ignore unknown event types to avoid noise
          break;
        }
      }
      return Promise.resolve();
    });
  }, [client]);

  // Connect to daemon with auto-reconnect
  useEffect(() => {
    isMountedRef.current = true;

    const runConnectionLoop = async (): Promise<void> => {
      while (isMountedRef.current) {
        try {
          await client.connect();
          setConnected(true);
          setConnectionError(null);

          // Subscribe to event topics
          const subscribeParams: Record<string, unknown> = {
            topics: [
              "run.*",
              "step.*",
              "tool.*",
              "llm.*",
              "permission.*",
              "session.*",
              "subagent.*",
              "context.*",
              "log.*",
              "skill.*",
            ],
            scope: "global",
          };
          if (lastRunIdRef.current) {
            subscribeParams["replay_from_run"] = lastRunIdRef.current;
          }
          await client.sendCommand("event.subscribe", subscribeParams);

          // Create or resume session
          if (!sessionIdRef.current) {
            const result = await client.sendCommand("session.create", {
              mode: "chat",
              title: "TUI Session",
            });
            const sid = result["session_id"];
            if (typeof sid === "string") {
              sessionIdRef.current = sid;
              setSessionLabel(sid.slice(0, 16));
            }
          }

          await client.waitForDisconnect();

          setConnected(false);
          setConnectionError("disconnected, retrying…");
          // Reset transient state so the UI does not keep a stale permission
          // dialog or a forever-spinning run across the disconnect.
          if (streamThrottleRef.current) {
            clearTimeout(streamThrottleRef.current);
            streamThrottleRef.current = null;
          }
          const pendingText = streamingTextRef.current;
          if (pendingText) {
            setMessages((prev) => [...prev, { role: "assistant" as const, content: pendingText }]);
          }
          streamingTextRef.current = "";
          setStreamingText("");
          setPermissionQueue([]);
          permissionInfoRef.current.clear();
          setActiveTools([]);
          setIsRunning(false);
          client.close();
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          setConnected(false);
          setConnectionError(errorMsg);
          client.close();
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 2000);
        });
      }
    };

    void runConnectionLoop();

    return () => {
      isMountedRef.current = false;
      client.close();
    };
  }, [client, _config]);

  // The brand header is drawn as a fixed component at the top of the render
  // tree (see below): console.log writes to the terminal scrollback buffer,
  // but the alt-screen has no scrollback region, so once the content grows the
  // banner would be pushed off screen.

  const handleSubmit = useCallback(
    async (value: string) => {
      if (!value.trim() || !connected) return;
      if (!sessionIdRef.current) {
        return;
      }

      const trimmed = value.trim();

      // Save to prompt history
      if (trimmed && !trimmed.startsWith("/")) {
        saveHistory(trimmed);
        setPromptHistory((prev) => [...prev, trimmed]);
      }

      // /compact command
      if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
        setIsRunning(true);
        try {
          const focus = trimmed.startsWith("/compact ") ? trimmed.slice(8).trim() : "";
          const result = await client.sendCommand("session.compact", {
            session_id: sessionIdRef.current,
            focus,
          });
          const summaryTokens = num(result, "summary_tokens");
          const savedTokens = num(result, "saved_tokens");
          const originalTokens = summaryTokens + savedTokens;
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `↻ compacted (saved ${String(savedTokens)} tokens: ${String(originalTokens)} → ${String(summaryTokens)})`,
            },
          ]);
          setContextPercent(0);
        } catch (error) {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `Compact failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ]);
        }
        setIsRunning(false);
        return;
      }

      // Normal message submission — show user message immediately
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setIsRunning(true);
      setCompletionMark(null);
      setActiveTools([]);
      streamingTextRef.current = "";
      setStreamingText("");

      try {
        await client.sendCommand("session.send_message", {
          session_id: sessionIdRef.current,
          content: trimmed,
        });
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ]);
        setIsRunning(false);
      }
    },
    [connected, client],
  );

  const handlePermissionRespond = useCallback(
    async (decision: PermissionAction) => {
      const current = permissionQueue[0];
      if (!current) return;
      // Dequeue: the next pending request (if any) becomes visible
      setPermissionQueue((prev) => prev.filter((r) => r.toolUseId !== current.toolUseId));
      try {
        await client.sendCommand("permission.respond", {
          tool_use_id: current.toolUseId,
          decision,
        });
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Permission respond failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ]);
      }
    },
    [permissionQueue, client],
  );

  // ── Scroll viewport ─────────────────────────────────────────────────────
  // The alt-screen has no native terminal scrollback region, so the message
  // history is scrolled by the app itself: the outer box has a fixed height
  // and clips overflow, while the inner box is shifted up by scrollTop lines
  // (negative marginTop) — equivalent to "translate the content, then clip to
  // the viewport".
  const viewportRef = useRef<DOMElement | null>(null);
  const contentRef = useRef<DOMElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // Stick-to-bottom follow: auto-scroll to the latest content as it arrives;
  // stop following once the user scrolls up manually.
  const stickToBottomRef = useRef(true);

  const maxScroll = Math.max(0, contentHeight - viewportHeight);

  // Enable SGR mouse tracking so the wheel is reported as mouse sequences
  // instead of being translated by the terminal into ↑/↓ that misfire the
  // input history.
  useEffect(() => {
    enableMouseTracking(stdout);
    return () => {
      disableMouseTracking(stdout);
    };
  }, [stdout]);

  // Measure the content and viewport heights once after each render, used to
  // compute the scrollable range. Runs without a dependency list on purpose;
  // the equality-guarded setters prevent an update loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (contentRef.current) {
      const h = measureElement(contentRef.current).height;
      setContentHeight((prev) => (prev === h ? prev : h));
    }
    if (viewportRef.current) {
      const h = measureElement(viewportRef.current).height;
      setViewportHeight((prev) => (prev === h ? prev : h));
    }
  });

  // When the content grows: follow to the latest if stuck to the bottom;
  // otherwise keep the current position, clamped to the valid range.
  useEffect(() => {
    setScrollTop((prev) => (stickToBottomRef.current ? maxScroll : Math.min(prev, maxScroll)));
  }, [maxScroll]);

  const scrollBy = useCallback(
    (delta: number) => {
      setScrollTop((prev) => {
        const next = Math.max(0, Math.min(prev + delta, maxScroll));
        stickToBottomRef.current = next >= maxScroll;
        return next;
      });
    },
    [maxScroll],
  );

  // The wheel and page keys drive scrolling. Mouse sequences never reach the
  // input box (they are already filtered by SGR format inside InputBox).
  useInput((input, key) => {
    const wheel = parseWheel(input);
    if (wheel) {
      scrollBy(wheel === "up" ? -3 : 3);
      return;
    }
    if (key.pageUp) {
      scrollBy(-Math.max(1, viewportHeight - 2));
    } else if (key.pageDown) {
      scrollBy(Math.max(1, viewportHeight - 2));
    }
  });

  return (
    <Box flexDirection="column" width="100%" height={Math.max(1, stdout.rows ?? 24)}>
      {/* Top brand header: fixed and non-shrinking within the render tree, so it stays on screen even in long conversations */}
      <Box flexDirection="column" flexShrink={0}>
        <Text>
          {COLORS.primary(" /\\_/\\    ")}
          {COLORS.dim("Larky v" + version)}
        </Text>
        <Text>
          {COLORS.primary("( o.o )   ")}
          {COLORS.dim(_config.host + ":" + String(_config.port))}
        </Text>
        <Text>
          {COLORS.primary(" > ^ <    ")}
          {COLORS.dim(process.cwd())}
        </Text>
      </Box>

      {/* Scroll viewport: fills the remaining middle space and clips overflow.
          minHeight={0} is critical: the content box's flexShrink={0} would otherwise
          push the viewport's minimum height up to the full content height, causing the
          bottom input box — once it grows — to push the total height past the root
          container and leave erase-misalignment artifacts. */}
      <Box
        ref={viewportRef}
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        flexDirection="column"
        overflowY="hidden"
      >
        <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-scrollTop}>
          {/* All messages live inside the render tree: scrolling is handled by the viewport, no longer relying on the terminal scrollback buffer */}
          <ChatView
            messages={messages}
            streamingText={isRunning ? streamingText : undefined}
            expanded={toolsExpanded}
          />

          {/* Real-time tool blocks */}
          {activeTools.length > 0 && !permissionRequest ? (
            <ToolDisplay tools={activeTools} />
          ) : null}

          {/* Spinner while running */}
          {isRunning && !permissionRequest ? (
            <Box paddingLeft={1} flexDirection="column">
              <Spinner inputTokens={inputTokens} outputTokens={outputTokens} />
            </Box>
          ) : null}

          {/* Context usage bar (Larky exclusive, preserved) */}
          {contextPercent > 0 ? (
            <Box paddingLeft={1}>
              <Text dimColor>context </Text>
              <Text color={contextBarColor(contextPercent)} bold={contextPercent >= 0.85}>
                {contextBarFill(contextPercent)}
              </Text>
              <Text dimColor> {(contextPercent * 100).toFixed(1)}%</Text>
            </Box>
          ) : null}

          {/* Connection status / errors */}
          {connectionError ? (
            <Box paddingLeft={1}>
              <Text color="red">{connectionError}</Text>
            </Box>
          ) : null}

          {/* Completion mark */}
          {!isRunning && completionMark && !permissionRequest ? (
            <Box paddingLeft={1}>
              <Text dimColor>{completionMark}</Text>
            </Box>
          ) : null}
        </Box>
      </Box>

      {/* Bottom region is fixed and non-shrinking: dialogs, status line, and the input box always render fully at the bottom of the screen */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Permission dialog overlay */}
        {permissionRequest ? (
          <PermissionDialog
            key={permissionRequest.toolUseId}
            toolName={permissionRequest.toolName}
            argsSummary={permissionRequest.argsSummary}
            onComplete={(decision: PermissionAction) => {
              void handlePermissionRespond(decision);
            }}
          />
        ) : null}

        {/* Ctrl+C hint */}
        {ctrlCHint ? (
          <Box paddingLeft={1}>
            <Text dimColor>
              {isRunning
                ? "Agent is running, waiting for it to finish..."
                : "Press Ctrl+C again to exit."}
            </Text>
          </Box>
        ) : null}

        {/* Session info line */}
        <Box paddingLeft={1}>
          <Text dimColor>
            {ICONS.dot} {connected ? "connected" : "disconnected"} {ICONS.dot} {sessionLabel}
            {totalTokens > 0 ? ` ${ICONS.dot} ${String(totalTokens)} tokens` : ""}
          </Text>
        </Box>

        {/* Input box */}
        <InputBox
          onSubmit={(text) => {
            void handleSubmit(text);
          }}
          disabled={isRunning || permissionRequest !== null || !connected}
          history={promptHistory}
          commands={commandsRef.current}
          inputState={
            connectionError ? "error" : isRunning || permissionRequest !== null ? "idle" : "focused"
          }
          permMode={permMode}
          onModeChange={(mode) => {
            setPermMode(mode);
          }}
          workDir={process.cwd()}
          onEscape={() => {
            // Escape during running does nothing (daemon-side run continues)
          }}
        />
      </Box>
    </Box>
  );
}
