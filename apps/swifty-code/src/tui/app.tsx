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

// Main TUI application: daemon client + event-driven rendering with Static/dynamic split
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";

import { COLORS, ICONS } from "./styles.js";
import { contextBarFill, contextBarColor } from "./theme.js";
import { ChatView, CommittedMessage, type ChatMessage } from "./chat.js";
import { ToolDisplay, type ToolBlockInfo } from "./tool-display.js";
import Spinner from "./spinner.js";
import { InputBox, type Cmd } from "./input.js";
import { PermissionDialog, type PermissionAction } from "./permission-dialog.js";
import { randomCompletionVerb } from "./verbs.js";

import type { SocketClient } from "../core/transport/socket-client.js";
import type { SwiftyConfig } from "../core/config.js";
import { SkillLoader } from "../core/skills/loader.js";
import { version } from "../version.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface AppProps {
  readonly _config: SwiftyConfig;
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
const HISTORY_FILE = `${process.env["HOME"] ?? ""}/.swifty/tui-history.json`;

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
  const [permissionRequest, setPermissionRequest] = useState<{
    toolName: string;
    argsSummary: string;
    toolUseId: string;
  } | null>(null);
  const [permMode, setPermMode] = useState<string>("default");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [ctrlCHint, setCtrlCHint] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>(loadHistory);
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState("connecting...");
  const committedIndexRef = useRef(0);
  const streamingTextRef = useRef("");
  const streamThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const headerPrintedRef = useRef(false);
  const lastRunIdRef = useRef<string | null>(null);
  const subagentStartTimes = useRef<Map<string, number>>(new Map());

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
          setMessages((prev) => {
            const next = [...prev, { role: "assistant" as const, content: fullText }];
            committedIndexRef.current = next.length;
            return next;
          });
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
          const runId = str(event, "run_id");
          if (runId) {
            lastRunIdRef.current = runId;
          }
          break;
        }

        case "run.finished": {
          flushStream();
          setIsRunning(false);
          setActiveTools([]);
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

        case "llm.token": {
          const token = str(event, "token");
          streamingTextRef.current += token;
          streamThrottleRef.current ??= setTimeout(() => {
            setStreamingText(streamingTextRef.current);
            streamThrottleRef.current = null;
          }, 50);
          break;
        }

        case "llm.text": {
          const text = str(event, "text");
          streamingTextRef.current += text;
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
          const paramsRaw = event["params"];
          const params = isRecord(paramsRaw) ? paramsRaw : {};
          setActiveTools((prev) => [...prev, { toolName, args: params, loading: true }]);
          break;
        }

        case "tool.call_finished": {
          const toolName = str(event, "tool_name");
          const output = str(event, "output");
          const elapsedMs = num(event, "elapsed_ms");
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolName === toolName && t.loading
                ? { ...t, output, elapsed: elapsedMs, loading: false }
                : t,
            ),
          );
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
          const errorMessage = str(event, "error_message");
          const elapsedMs = num(event, "elapsed_ms");
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolName === toolName && t.loading
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
          setPermissionRequest({
            toolName,
            argsSummary: paramsPreview,
            toolUseId,
          });
          break;
        }

        case "permission.granted":
        case "permission.denied": {
          const decision = str(event, "decision");
          const granted = eventType === "permission.granted";
          setPermissionRequest(null);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: granted ? `✓ permission ${decision}` : `✗ permission ${decision}`,
            },
          ]);
          break;
        }

        case "session.waiting_for_input": {
          flushStream();
          setIsRunning(false);
          setActiveTools([]);
          setPermissionRequest(null);
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
          if (runId) {
            subagentStartTimes.current.set(runId, Date.now());
          }
          const description = str(event, "description");
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `↳ subagent: ${description}` },
          ]);
          break;
        }

        case "subagent.finished": {
          const runId = str(event, "run_id");
          const status = str(event, "status");
          const startTime = subagentStartTimes.current.get(runId);
          if (startTime !== undefined) {
            subagentStartTimes.current.delete(runId);
          }
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `↳ subagent done: ${status}` },
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
          const level = str(event, "level") || "INFO";
          const message = str(event, "message");
          if (level === "ERROR" || level === "WARNING" || level === "WARN") {
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

  // Print header banner once after the first successful connection.
  // Mirrors apps/swifty/src/tui/app.tsx: use a ref guard so the banner is
  // printed exactly once, and use console.log instead of
  // process.stdout.write("\x1b[2J\x1b[H"...) — clearing the screen wipes
  // Ink's rendered output and desyncs its internal line cursor, which
  // previously caused the app not to render and the input box to appear
  // twice on startup (every reconnect re-ran the clear+banner block).
  useEffect(() => {
    if (!connected || headerPrintedRef.current) {
      return;
    }
    headerPrintedRef.current = true;
    const p = COLORS.primary;
    const d = COLORS.dim;
    console.log(`\n${p(" /\\_/\\    ")}${d("SwiftyCode v" + version)}`);
    console.log(`${p("( o.o )   ")}${d(_config.host + ":" + String(_config.port))}`);
    console.log(`${p(" > ^ <    ")}${d(process.cwd())}\n`);
  }, [connected, _config]);

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
      if (!permissionRequest) return;
      setPermissionRequest(null);
      try {
        await client.sendCommand("permission.respond", {
          tool_use_id: permissionRequest.toolUseId,
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
    [permissionRequest, client],
  );

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexDirection="column" paddingTop={0} flexGrow={1}>
        {/* Committed messages: written to terminal scrollback, never re-rendered */}
        <Static
          items={messages
            .slice(0, committedIndexRef.current)
            .map((msg, i) => ({ ...msg, _key: i }))}
        >
          {(item) => (
            <CommittedMessage key={String(item._key)} message={item} expanded={toolsExpanded} />
          )}
        </Static>

        {/* Active content: streaming + new messages */}
        <ChatView
          messages={messages.slice(committedIndexRef.current)}
          streamingText={isRunning ? streamingText : undefined}
          expanded={toolsExpanded}
        />

        {/* Real-time tool blocks */}
        {activeTools.length > 0 && !permissionRequest ? <ToolDisplay tools={activeTools} /> : null}

        {/* Spinner while running */}
        {isRunning && !permissionRequest ? (
          <Box paddingLeft={1} flexDirection="column">
            <Spinner inputTokens={inputTokens} outputTokens={outputTokens} />
          </Box>
        ) : null}

        {/* Context usage bar (SwiftyCode exclusive, preserved) */}
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

        {/* Session info line */}
        <Box paddingLeft={1}>
          <Text dimColor>
            {ICONS.dot} {connected ? "connected" : "disconnected"} {ICONS.dot} {sessionLabel}
            {totalTokens > 0 ? ` ${ICONS.dot} ${String(totalTokens)} tokens` : ""}
          </Text>
        </Box>

        <Text> </Text>
      </Box>

      {/* Permission dialog overlay */}
      {permissionRequest ? (
        <PermissionDialog
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
  );
}
