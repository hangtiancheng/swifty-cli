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

// TUI App: thin socket client for the larky-core daemon. All agent state
// (LLM, tools, permissions, sessions) lives daemon-side; this component
// renders the event stream and answers interaction requests via RPCs.
// Local-only concerns: prompt history, @-file completion, scrolling, theme.
import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useApp, useInput, useStdout, measureElement, type DOMElement } from "ink";

import type { ProviderConfig } from "../config/config.js";
import type { PermissionMode } from "../permissions/checker.js";
import type { Command } from "../commands/commands.js";
import { CommandUsageTracker } from "../commands/usage-tracker.js";
import * as historyMod from "../history/history.js";
import type { Question } from "../tools/ask-user.js";
import type { Snapshot } from "../file-history/file-history.js";
import { TeammateUIStateSchema, type TeammateUIState } from "../teams/progress.js";
import { strArg } from "../utils/index.js";
import { z } from "zod";

import { IpcError, type SocketClient } from "../core/transport/socket-client.js";
import { EventSchema, type Event } from "../core/bus/events.js";
import { isStaleRunEvent } from "./run-filter.js";

import RewindDialog, { type RewindAction } from "./rewind-dialog.js";
import { PermissionDialog, type PermissionAction } from "./permission-dialog.js";
import { AskUserDialog } from "./ask-user-dialog.js";
import { PlanApprovalDialog, type PlanChoice } from "./plan-approval.js";
import { TeammateSpinnerTree } from "./teammate-spinner-tree.js";
import { TeamStatus } from "./team-status.js";
import { TeamsDialog } from "./teams-dialog.js";
import { enableMouseTracking, disableMouseTracking, parseWheel } from "./mouse.js";
import { InputBox } from "./input.js";
import { ChatView, type ChatMessage, type ToolSummaryItem } from "./chat.js";
import { ToolDisplay, type ToolBlockInfo } from "./tool-display.js";
import Spinner from "./spinner.js";
import { ICONS } from "./styles.js";
import { randomCompletionVerb } from "./verbs.js";
import { version } from "./version.js";

interface Props {
  client: SocketClient;
  provider: ProviderConfig;
  permissionMode?: string;
  // Reports the live daemon session id so the launcher can session.close on exit.
  onSessionChange?: (id: string) => void;
}

const WireCommandInfoSchema = z.object({
  name: z.string(),
  description: z.string().catch(""),
  aliases: z.array(z.string()).catch([]),
});
const WireCommandListSchema = z.array(WireCommandInfoSchema);
type WireCommandInfo = z.infer<typeof WireCommandInfoSchema>;

const WireSnapshotSchema = z
  .object({
    message_index: z.number().catch(0),
    user_text: z.string().catch(""),
    file_count: z.number().catch(0),
    timestamp: z.string().catch(""),
  })
  .catch({ message_index: 0, user_text: "", file_count: 0, timestamp: "" });

interface PermissionUiRequest {
  id: string;
  toolName: string;
  argsSummary: string;
  reason: string;
}

interface AskUiRequest {
  id: string;
  questions: Question[];
}

interface PlanUiRequest {
  id: string;
}

const truncate = (s: string, max: number): string => (s.length > max ? s.slice(0, max) + "…" : s);

function formatToolArgs(args: Record<string, unknown>): string {
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

function isPermissionModeStr(mode: string): mode is PermissionMode {
  return ["default", "acceptEdits", "plan", "bypassPermissions"].includes(mode);
}

// Wire command list → Command[] stubs for the InputBox autocomplete.
function toInputCommands(infos: WireCommandInfo[]): Command[] {
  return infos.map((c) => ({
    name: c.name,
    aliases: c.aliases,
    type: "local",
    description: c.description,
    handler: () => "",
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirrors core/app.ts SESSION_NOT_FOUND: daemon restarted / session evicted.
const SESSION_NOT_FOUND = -32010;

export function App({ client, provider, permissionMode, onSessionChange }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const workDir = process.cwd();
  const historyDir = `${workDir}/.larky`;

  // -- Rendering state ------------------------------------------------------
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [completionMark, setCompletionMark] = useState<string | null>(null);
  const [activeTools, setActiveTools] = useState<ToolBlockInfo[]>([]);
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [teammateStates, setTeammateStates] = useState<TeammateUIState[]>([]);
  const [teamsDialogOpen, setTeamsDialogOpen] = useState(false);
  const [subagents, setSubagents] = useState<{ id: string; label: string; detail: string }[]>([]);

  const [permMode, setPermMode] = useState<PermissionMode>(() => {
    if (process.env.LARKY_BYPASS_PERMISSIONS === "1") {
      return "bypassPermissions";
    }
    if (permissionMode && isPermissionModeStr(permissionMode)) {
      return permissionMode;
    }
    return "default";
  });

  // Interaction dialogs
  const [permissionQueue, setPermissionQueue] = useState<PermissionUiRequest[]>([]);
  const [askRequest, setAskRequest] = useState<AskUiRequest | null>(null);
  const [planRequest, setPlanRequest] = useState<PlanUiRequest | null>(null);
  const [rewindDialogActive, setRewindDialogActive] = useState(false);
  const [rewindSnapshots, setRewindSnapshots] = useState<Snapshot[]>([]);

  // -- Refs -------------------------------------------------------------------
  const sessionIdRef = useRef<string>("");
  const lastRunIdRef = useRef<string | null>(null);

  // Replay cursor: persisted (run-scoped) events already applied for the
  // current run; sent as replay_offset on resubscribe to avoid re-rendering.
  const replayedCountRef = useRef(0);
  const isStreamingRef = useRef(false);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const streamStartRef = useRef(0);
  const streamingTextRef = useRef("");
  const fullTextRef = useRef("");
  const streamThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedIndexRef = useRef(0);
  const usageTrackerRef = useRef(new CommandUsageTracker(workDir));

  // Per-turn accumulators for the folded turn_summary display.
  const turnThinkingTextRef = useRef("");
  const turnThinkingStartRef = useRef(0);
  const turnThinkingDurationRef = useRef(0);
  const turnToolCallsRef = useRef<ToolSummaryItem[]>([]);
  const pendingToolArgsRef = useRef(new Map<string, string>());

  const resetTurnAccumulators = () => {
    turnThinkingTextRef.current = "";
    turnThinkingStartRef.current = 0;
    turnThinkingDurationRef.current = 0;
    turnToolCallsRef.current = [];
    pendingToolArgsRef.current.clear();
  };

  const pushSystem = useCallback((content: string) => {
    setMessages((prev) => [...prev, { role: "system", content }]);
  }, []);

  // -- RPC helpers ------------------------------------------------------------

  const sendCommand = useCallback(
    async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
      return client.sendCommand(method, params);
    },
    [client],
  );

  const rpc = useCallback(
    (method: string, params: Record<string, unknown>) => {
      sendCommand(method, params).catch((err: unknown) => {
        if (err instanceof IpcError && err.code === SESSION_NOT_FOUND) {
          sessionIdRef.current = "";
          lastRunIdRef.current = null;
          replayedCountRef.current = 0;
          pushSystem("(session lost — it will be recreated on your next input)");
          return;
        }
        pushSystem(`RPC ${method} failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [sendCommand, pushSystem],
  );

  // Creates (or recreates, after daemon restart / session loss) the daemon
  // session. Uses only refs and stable props, so the mount-time closure in
  // the connection loop stays valid.
  const createSession = useCallback(async () => {
    // LARKY_BYPASS_PERMISSIONS must reach the daemon (swifty parity where the
    // env directly drove the permission checker), not just the local UI badge.
    const envBypass = process.env.LARKY_BYPASS_PERMISSIONS === "1";
    const res = await client.sendCommand("session.create", {
      permission_mode: envBypass
        ? "bypassPermissions"
        : permissionMode && isPermissionModeStr(permissionMode)
          ? permissionMode
          : null,
      persist: true,
    });
    sessionIdRef.current = typeof res.session_id === "string" ? res.session_id : "";
    onSessionChange?.(sessionIdRef.current);
    const commandList = WireCommandListSchema.safeParse(res.commands);
    if (commandList.success) {
      setCommands(toInputCommands(commandList.data));
    }
    const mode = typeof res.permission_mode === "string" ? res.permission_mode : "";
    if (isPermissionModeStr(mode)) {
      setPermMode(mode);
    }
  }, [client, permissionMode, onSessionChange]);

  // -- Event handling ----------------------------------------------------------

  const flushStreamThrottle = () => {
    if (streamThrottleRef.current) {
      clearTimeout(streamThrottleRef.current);
      streamThrottleRef.current = null;
    }
  };

  const handleEvent = useCallback(
    (raw: Record<string, unknown>) => {
      // Advance the replay cursor on RAW fields, before schema parsing: the
      // daemon persists every non-empty-run_id line schema-agnostically, so
      // unknown (future) event types must still advance the cursor or a
      // reconnect would replay already-applied events.
      const rawRunId = typeof raw.run_id === "string" ? raw.run_id : "";
      const rawSession = typeof raw.session_id === "string" ? raw.session_id : "";
      if (rawRunId) {
        if (raw.type === "run.started") {
          if (sessionIdRef.current && rawSession === sessionIdRef.current) {
            replayedCountRef.current = 1; // run.started is the run's first line
          }
        } else if (rawRunId === lastRunIdRef.current) {
          replayedCountRef.current += 1;
        }
      }

      const parsed = EventSchema.safeParse(raw);
      if (!parsed.success) {
        return;
      } // unknown event types are forward-compatible noise
      const event: Event = parsed.data;

      // Session filtering: ignore events for other sessions. While our own
      // session id is unknown (startup / just reset), any session-scoped
      // event necessarily belongs to someone else — drop it too.
      if ("session_id" in event && event.session_id) {
        if (!sessionIdRef.current || event.session_id !== sessionIdRef.current) {
          return;
        }
      }

      // Run filtering: after steering, the cancelled run's late events
      // (esp. its interrupted loop_complete) must not clobber the new run.
      if (isStaleRunEvent(event, lastRunIdRef.current)) {
        return;
      }

      // Reconnect mid-run: disconnect cleared isStreaming and the replay
      // offset skips run.started — live events of the current run restore
      // the streaming state (Esc / Ctrl+C cancel depend on it).
      if (
        !isStreamingRef.current &&
        lastRunIdRef.current !== null &&
        event.type.startsWith("agent.") &&
        event.type !== "agent.loop_complete" &&
        "run_id" in event &&
        event.run_id === lastRunIdRef.current
      ) {
        setIsStreaming(true);
      }

      switch (event.type) {
        case "run.started":
          lastRunIdRef.current = event.run_id;
          // Daemon-initiated runs (plan execution, feedback) carry trigger
          // text the user never typed; client-origin runs were already
          // echoed locally by handleSubmit.
          if (event.origin === "daemon" && event.content) {
            setMessages((prev) => [...prev, { role: "user", content: event.content }]);
          }
          streamStartRef.current = Date.now();
          setCompletionMark(null);
          setError(null);
          setIsStreaming(true);
          setStreamingText("");
          fullTextRef.current = "";
          streamingTextRef.current = "";
          break;

        case "agent.stream_text":
          fullTextRef.current += event.text;
          streamingTextRef.current = fullTextRef.current;
          // Throttled streaming: flush within 50ms to reduce re-render churn
          streamThrottleRef.current ??= setTimeout(() => {
            setStreamingText(streamingTextRef.current);
            streamThrottleRef.current = null;
          }, 50);
          break;

        case "agent.thinking_text":
          if (!turnThinkingStartRef.current) {
            turnThinkingStartRef.current = Date.now();
          }
          turnThinkingTextRef.current += event.text;
          break;

        case "agent.thinking_complete":
          if (turnThinkingStartRef.current) {
            turnThinkingDurationRef.current = (Date.now() - turnThinkingStartRef.current) / 1000;
          }
          break;

        case "agent.tool_use": {
          const argsSummary = formatToolArgs(event.args);
          pendingToolArgsRef.current.set(`${event.tool_name}:${event.tool_id}`, argsSummary);
          setActiveTools((prev) => [
            ...prev,
            { toolName: event.tool_name, args: event.args, loading: true },
          ]);
          break;
        }

        case "agent.tool_result": {
          const argsSummary =
            pendingToolArgsRef.current.get(`${event.tool_name}:${event.tool_id}`) ?? "";
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolName === event.tool_name && t.loading
                ? {
                    ...t,
                    output: event.output,
                    isError: event.is_error,
                    elapsed: event.elapsed_ms,
                    loading: false,
                  }
                : t,
            ),
          );
          turnToolCallsRef.current.push({
            toolName: event.tool_name,
            argsSummary,
            output: event.output,
            isError: event.is_error,
            elapsed: event.elapsed_ms,
          });
          break;
        }

        case "agent.usage":
          setInputTokens((prev) => prev + event.input_tokens);
          setOutputTokens((prev) => prev + event.output_tokens);
          break;

        case "agent.compact":
          pushSystem(`⊙ ${event.message}`);
          break;

        case "agent.retry":
          pushSystem(
            `↻ ${event.reason}${event.delay_ms ? ` (waiting ${String(Math.round(event.delay_ms / 1000))}s)` : ""}`,
          );
          break;

        case "agent.turn_complete": {
          flushStreamThrottle();
          setStreamingText("");
          fullTextRef.current = "";
          streamingTextRef.current = "";
          setActiveTools([]);
          const hasTurnContent = turnThinkingTextRef.current || turnToolCallsRef.current.length > 0;
          if (hasTurnContent) {
            const summary: ChatMessage = {
              role: "turn_summary",
              content: turnThinkingTextRef.current,
              thinkingDuration:
                turnThinkingDurationRef.current > 0 ? turnThinkingDurationRef.current : undefined,
              toolSummary:
                turnToolCallsRef.current.length > 0 ? [...turnToolCallsRef.current] : undefined,
            };
            setMessages((prev) => {
              const next = [...prev, summary];
              committedIndexRef.current = next.length;
              return next;
            });
          }
          resetTurnAccumulators();
          break;
        }

        case "agent.loop_complete": {
          flushStreamThrottle();
          setStreamingText("");
          const fullText = fullTextRef.current;
          fullTextRef.current = "";
          streamingTextRef.current = "";
          if (fullText) {
            const suffix = event.stop_reason === "interrupted" ? "\n\n*[cancelled]*" : "";
            setMessages((prev) => {
              const next = [...prev, { role: "assistant" as const, content: fullText + suffix }];
              committedIndexRef.current = next.length;
              return next;
            });
          } else {
            setMessages((prev) => {
              committedIndexRef.current = prev.length;
              return prev;
            });
          }
          setActiveTools([]);
          resetTurnAccumulators();
          setIsStreaming(false);
          // Run finished: nothing to replay on reconnect.
          lastRunIdRef.current = null;
          replayedCountRef.current = 0;
          const elapsed = Math.floor((Date.now() - streamStartRef.current) / 1000);
          setCompletionMark(`✻ ${randomCompletionVerb()} for ${String(elapsed)}s`);
          break;
        }

        case "agent.error":
          setError(event.message);
          pushSystem(`Error: ${event.message}`);
          break;

        case "system.message":
          pushSystem(event.message);
          break;

        case "command.done":
          break;

        case "ui.clear":
          setMessages([]);
          committedIndexRef.current = 0;
          setInputTokens(0);
          setOutputTokens(0);
          setCompletionMark(null);
          break;

        case "replay.message":
          setMessages((prev) => {
            const next: ChatMessage[] = [
              ...prev,
              {
                role: event.role === "user" ? ("user" as const) : ("assistant" as const),
                content: event.content,
              },
            ];
            committedIndexRef.current = next.length;
            return next;
          });
          break;

        case "mode.changed":
          if (isPermissionModeStr(event.mode)) {
            setPermMode(event.mode);
          }
          break;

        case "permission.requested": {
          const req: PermissionUiRequest = {
            id: event.id,
            toolName: event.tool_name,
            argsSummary: formatToolArgs(event.args),
            reason: event.reason,
          };
          setPermissionQueue((prev) => (prev.some((p) => p.id === req.id) ? prev : [...prev, req]));
          break;
        }

        case "permission.resolved":
          setPermissionQueue((prev) => prev.filter((p) => p.id !== event.id));
          break;

        case "ask_user.requested": {
          const questions: Question[] = event.questions.map((q) => ({
            question: q.question,
            header: q.header,
            options: q.options.map((o) => ({
              label: o.label,
              ...(o.description !== undefined ? { description: o.description } : {}),
            })),
            multiSelect: q.multiSelect,
          }));
          setAskRequest({ id: event.id, questions });
          break;
        }

        case "ask_user.resolved":
          setAskRequest((prev) => (prev?.id === event.id ? null : prev));
          break;

        case "plan.requested":
          setPlanRequest({ id: event.id });
          break;

        case "plan.resolved":
          setPlanRequest((prev) => (prev?.id === event.id ? null : prev));
          break;

        case "todo.updated":
          // Todos surface via TaskList tool output; no dedicated pane yet.
          break;

        case "teammate.state": {
          const state = z.array(TeammateUIStateSchema).safeParse(event.states);
          if (state.success) {
            setTeammateStates(state.data);
          }
          break;
        }

        case "subagent.progress":
          setSubagents((prev) => {
            if (event.status === "done") {
              return prev.filter((s) => s.id !== event.task_id);
            }
            const existing = prev.find((s) => s.id === event.task_id);
            if (existing) {
              return prev.map((s) => (s.id === event.task_id ? { ...s, detail: event.detail } : s));
            }
            return [
              ...prev,
              {
                id: event.task_id,
                label: event.description,
                detail: event.detail,
              },
            ];
          });
          break;

        default:
          break;
      }
    },
    [pushSystem],
  );

  // -- Connection loop -----------------------------------------------------------

  const handleEventRef = useRef(handleEvent);
  useEffect(() => {
    handleEventRef.current = handleEvent;
  }, [handleEvent]);

  useEffect(() => {
    let cancelled = false;

    // Register the event handler once; it persists across reconnections.
    client.onEvent((event) => {
      handleEventRef.current(event);
      return Promise.resolve();
    });

    const loop = async () => {
      while (!cancelled) {
        try {
          await client.connect();
        } catch {
          await sleep(2000);
          continue;
        }
        setConnected(true);
        try {
          // Probe: the daemon may have restarted (in-memory sessions lost).
          // Detect it before subscribing so we never replay a dead run.
          if (sessionIdRef.current) {
            try {
              await client.sendCommand("command.list", { session_id: sessionIdRef.current });
            } catch (probeErr) {
              if (probeErr instanceof IpcError && probeErr.code === SESSION_NOT_FOUND) {
                sessionIdRef.current = "";
                lastRunIdRef.current = null;
                replayedCountRef.current = 0;
                pushSystem(
                  "(daemon restarted — session reset; transcript kept, model context lost)",
                );
              }
            }
          }
          await client.sendCommand("event.subscribe", {
            topics: ["*"],
            scope: "global",
            replay_from_run: sessionIdRef.current ? lastRunIdRef.current : null,
            replay_offset: replayedCountRef.current,
          });
          if (!sessionIdRef.current) {
            await createSession();
          }
        } catch (err) {
          setError(`daemon setup failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        await client.waitForDisconnect();
        if (cancelled) {
          break;
        }
        setConnected(false);
        // Clear transient run state; pending dialogs are daemon-side cancelled.
        setIsStreaming(false);
        setActiveTools([]);
        setPermissionQueue([]);
        setAskRequest(null);
        setPlanRequest(null);
        pushSystem("(disconnected from daemon — reconnecting…)");
        await sleep(2000);
      }
    };
    void loop();

    setPromptHistory(historyMod.load(historyDir));

    return () => {
      // Socket lifecycle belongs to the launcher (tui/index.tsx), which must
      // still send session.close AFTER unmount — closing here would race it.
      cancelled = true;
    };
  }, []);

  // -- Keyboard shortcuts ----------------------------------------------------

  const ctrlCCountRef = useRef(0);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ctrlCHint, setCtrlCHint] = useState(false);
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (isStreaming && sessionIdRef.current) {
        rpc("run.cancel", { session_id: sessionIdRef.current });
        ctrlCCountRef.current = 0;
        return;
      }
      ctrlCCountRef.current += 1;
      if (ctrlCCountRef.current >= 2) {
        exit();
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

  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setToolsExpanded((e) => !e);
    }
  });

  useInput(
    (input, key) => {
      if (key.ctrl && input === "t" && !isStreaming) {
        setTeamsDialogOpen((prev) => !prev);
      }
    },
    { isActive: !teamsDialogOpen },
  );

  // -- Submission -------------------------------------------------------------

  const submittingRef = useRef(false);

  const handleSubmit = async (text: string) => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    try {
      historyMod.append(historyDir, text);
      setPromptHistory((prev) => [...prev, text]);

      if (!sessionIdRef.current) {
        // Session lost (daemon restart) — recreate before submitting.
        try {
          await createSession();
        } catch {
          setError("Not connected to daemon yet");
          return;
        }
      }

      if (text.startsWith("/")) {
        const name = text.slice(1).split(/\s+/)[0];
        usageTrackerRef.current.record(name);

        // Client-side commands
        if (name === "quit" || name === "exit" || name === "q") {
          exit();
          return;
        }
        if (name === "rewind") {
          await openRewindDialog();
          return;
        }
        // Everything else runs daemon-side (one-shot -32010 recovery).
        setMessages((prev) => [...prev, { role: "user", content: text }]);
        try {
          await sendCommand("command.run", { session_id: sessionIdRef.current, input: text });
        } catch (err) {
          if (err instanceof IpcError && err.code === SESSION_NOT_FOUND) {
            try {
              sessionIdRef.current = "";
              lastRunIdRef.current = null;
              replayedCountRef.current = 0;
              await createSession();
              await sendCommand("command.run", { session_id: sessionIdRef.current, input: text });
              return;
            } catch (retryErr) {
              pushSystem(
                `RPC command.run failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
              );
              return;
            }
          }
          pushSystem(`RPC command.run failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setError(null);
      // Immediate optimistic streaming state; run.started confirms.
      streamStartRef.current = Date.now();
      setCompletionMark(null);
      setIsStreaming(true);
      setStreamingText("");
      try {
        await sendCommand("session.send_message", {
          session_id: sessionIdRef.current,
          content: text,
        });
      } catch (err) {
        // One-shot recovery: the session may have died between probe and send.
        if (err instanceof IpcError && err.code === SESSION_NOT_FOUND) {
          try {
            sessionIdRef.current = "";
            lastRunIdRef.current = null;
            replayedCountRef.current = 0;
            await createSession();
            await sendCommand("session.send_message", {
              session_id: sessionIdRef.current,
              content: text,
            });
            return;
          } catch (retryErr) {
            setIsStreaming(false);
            setError(retryErr instanceof Error ? retryErr.message : String(retryErr));
            return;
          }
        }
        setIsStreaming(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const openRewindDialog = async () => {
    try {
      const res = await sendCommand("rewind.list", {
        session_id: sessionIdRef.current,
      });
      const raw = Array.isArray(res.snapshots) ? res.snapshots : [];
      if (raw.length === 0) {
        pushSystem("No checkpoints to rewind to.");
        return;
      }
      const snapshots: Snapshot[] = raw.map((s) => {
        const rec = WireSnapshotSchema.parse(s);
        return {
          messageIndex: rec.message_index,
          userText: rec.user_text,
          backups: Object.fromEntries(
            Array.from({ length: rec.file_count }, (_, i) => [
              `file-${String(i)}`,
              { backupPath: "", version: 0, time: "" },
            ]),
          ),
          timestamp: rec.timestamp,
        };
      });
      setRewindSnapshots(snapshots);
      setRewindDialogActive(true);
    } catch (err) {
      pushSystem(`Rewind failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRewindAction = useCallback(
    (action: RewindAction) => {
      setRewindDialogActive(false);
      if (action.type === "cancel") {
        return;
      }
      const mode =
        action.type === "code_and_conversation"
          ? "both"
          : action.type === "code_only"
            ? "files"
            : "conversation";
      rpc("rewind.apply", {
        session_id: sessionIdRef.current,
        index: action.snapshotIndex,
        mode,
      });
    },
    [rpc],
  );

  const handlePlanApproval = useCallback(
    (choice: PlanChoice, feedback?: string) => {
      const req = planRequest;
      setPlanRequest(null);
      if (!req) {
        return;
      }
      rpc("plan.respond", { id: req.id, choice, feedback: feedback ?? "" });
    },
    [planRequest, rpc],
  );

  const handlePermissionComplete = useCallback(
    (id: string, action: PermissionAction) => {
      setPermissionQueue((prev) => prev.filter((p) => p.id !== id));
      rpc("permission.respond", { id, response: action });
    },
    [rpc],
  );

  const handleModeChange = useCallback(
    (mode: PermissionMode) => {
      setPermMode(mode);
      if (sessionIdRef.current) {
        rpc("mode.set", { session_id: sessionIdRef.current, mode });
      }
    },
    [rpc],
  );

  // ── Scroll viewport ─────────────────────────────────────────────────────
  const viewportRef = useRef<DOMElement | null>(null);
  const contentRef = useRef<DOMElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const stickToBottomRef = useRef(true);

  const maxScroll = Math.max(0, contentHeight - viewportHeight);

  useEffect(() => {
    enableMouseTracking(stdout);
    return () => {
      disableMouseTracking(stdout);
    };
  }, [stdout]);

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

  const activePermission = permissionQueue[0] ?? null;

  return (
    <Box flexDirection="column" width="100%" height={Math.max(1, stdout.rows ?? 24)}>
      {/* Top brand header */}
      <Box flexDirection="column" flexShrink={0}>
        <Text>
          <Text color="#a78bfa"> /\_/\ </Text>
          <Text dimColor>
            Larky v{version}
            {connected ? "" : "  (connecting…)"}
          </Text>
        </Text>
        <Text>
          <Text color="#a78bfa">( o.o ) </Text>
          <Text dimColor>{provider.model || provider.name}</Text>
        </Text>
        <Text>
          <Text color="#a78bfa">
            {" "}
            {">"} ^ {"<"}{" "}
          </Text>
          <Text dimColor>{workDir}</Text>
        </Text>
      </Box>

      {/* Scroll viewport */}
      <Box
        ref={viewportRef}
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        flexDirection="column"
        overflowY="hidden"
      >
        <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-scrollTop}>
          <ChatView
            messages={messages}
            streamingText={isStreaming ? streamingText : undefined}
            expanded={toolsExpanded}
          />

          {activeTools.length > 0 && !askRequest && <ToolDisplay tools={activeTools} />}

          {subagents.length > 0 && !askRequest && (
            <Box flexDirection="column" paddingLeft={1}>
              {subagents.map((s) => (
                <Text key={s.id} color="magenta">
                  {ICONS.dot} {s.label} subagent
                  {s.detail ? ` · ${s.detail}` : ""}
                </Text>
              ))}
            </Box>
          )}

          {isStreaming && !askRequest && (
            <Box paddingLeft={1} flexDirection="column">
              <Spinner inputTokens={inputTokens} outputTokens={outputTokens} />
              {teammateStates.length > 0 && (
                <TeammateSpinnerTree
                  teammates={teammateStates}
                  leaderTokens={inputTokens + outputTokens}
                />
              )}
            </Box>
          )}
          {!isStreaming && teammateStates.some((t) => t.status === "running") && (
            <Box paddingLeft={1}>
              <TeammateSpinnerTree teammates={teammateStates} />
            </Box>
          )}

          {error && (
            <Box paddingLeft={1}>
              <Text color="red">{error}</Text>
            </Box>
          )}

          {!isStreaming && completionMark && !askRequest && !activePermission && (
            <Box paddingLeft={1}>
              <Text dimColor>{completionMark}</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Bottom fixed region: dialogs + input */}
      <Box flexDirection="column" flexShrink={0}>
        {planRequest && <PlanApprovalDialog onSelect={handlePlanApproval} />}

        {rewindDialogActive && (
          <RewindDialog
            snapshots={rewindSnapshots}
            onComplete={handleRewindAction}
            onCancel={() => {
              setRewindDialogActive(false);
            }}
          />
        )}

        {activePermission && (
          <PermissionDialog
            toolName={activePermission.toolName}
            argsSummary={activePermission.argsSummary}
            reason={activePermission.reason}
            onComplete={(action: PermissionAction) => {
              handlePermissionComplete(activePermission.id, action);
            }}
          />
        )}

        {askRequest && (
          <AskUserDialog
            questions={askRequest.questions}
            onComplete={(answers) => {
              const req = askRequest;
              setAskRequest(null);
              rpc("ask_user.respond", { id: req.id, answers });
            }}
          />
        )}

        {teamsDialogOpen && (
          <TeamsDialog
            teammates={teammateStates}
            onClose={() => {
              setTeamsDialogOpen(false);
            }}
            onKill={() => {
              // Teams management runs daemon-side; direct kill not yet wired.
            }}
            onShutdown={() => {
              // Teams management runs daemon-side; direct shutdown not yet wired.
            }}
          />
        )}

        {ctrlCHint && (
          <Box paddingLeft={1}>
            <Text dimColor>Press Ctrl+C again to exit.</Text>
          </Box>
        )}
        <TeamStatus
          count={teammateStates.filter((t) => t.status === "running" || t.status === "idle").length}
        />
        <InputBox
          onSubmit={(text: string) => {
            void handleSubmit(text);
          }}
          disabled={rewindDialogActive || activePermission !== null || askRequest !== null}
          history={promptHistory}
          commands={commands}
          usageTracker={usageTrackerRef.current}
          inputState={
            error
              ? "error"
              : isStreaming || rewindDialogActive || activePermission
                ? "idle"
                : "focused"
          }
          permMode={permMode}
          onModeChange={handleModeChange}
          workDir={workDir}
          onEscape={() => {
            if (isStreamingRef.current && sessionIdRef.current) {
              rpc("run.cancel", { session_id: sessionIdRef.current });
            }
          }}
        />
      </Box>
    </Box>
  );
}
