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

// Wire protocol event schemas (daemon → client), routed by the `type` field.
// Agent stream events map 1:1 to larky AgentEvent variants; interaction
// request events carry an `id` that the client answers via the matching
// *.respond RPC (permission.respond / ask_user.respond / plan.respond).
import { z } from "zod";

// ---- Shared shapes ----

// Mirrors larky tools/ask-user.ts Question
export const WireQuestionSchema = z.object({
  question: z.string(),
  header: z.string(),
  options: z.array(
    z.object({
      label: z.string(),
      description: z.string().optional(),
    }),
  ),
  multiSelect: z.boolean().default(false),
});
export type WireQuestion = z.infer<typeof WireQuestionSchema>;

// ---- Core lifecycle ----

export const CoreStartedEventSchema = z.object({
  type: z.literal("core.started").default("core.started"),
  listen_addr: z.string(),
  version: z.string(),
  timestamp: z.string(),
});
export type CoreStartedEvent = z.infer<typeof CoreStartedEventSchema>;

export const LogLineEventSchema = z.object({
  type: z.literal("log.line").default("log.line"),
  session_id: z.string().default(""),
  run_id: z.string().default(""),
  level: z.string(),
  source: z.string(),
  message: z.string(),
  timestamp: z.string(),
});
export type LogLineEvent = z.infer<typeof LogLineEventSchema>;

// ---- Session lifecycle ----

export const SessionCreatedEventSchema = z.object({
  type: z.literal("session.created").default("session.created"),
  session_id: z.string(),
  cwd: z.string(),
  timestamp: z.string(),
});
export type SessionCreatedEvent = z.infer<typeof SessionCreatedEventSchema>;

export const SessionClosedEventSchema = z.object({
  type: z.literal("session.closed").default("session.closed"),
  session_id: z.string(),
  timestamp: z.string(),
});
export type SessionClosedEvent = z.infer<typeof SessionClosedEventSchema>;

// ---- Run lifecycle ----

export const RunStartedEventSchema = z.object({
  type: z.literal("run.started").default("run.started"),
  session_id: z.string(),
  run_id: z.string(),
  content: z.string(),
  timestamp: z.string(),
});
export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;

// ---- Agent stream events (1:1 with larky AgentEvent) ----

export const StreamTextEventSchema = z.object({
  type: z.literal("agent.stream_text").default("agent.stream_text"),
  session_id: z.string(),
  run_id: z.string(),
  text: z.string(),
  timestamp: z.string(),
});
export type StreamTextEvent = z.infer<typeof StreamTextEventSchema>;

export const ThinkingTextEventSchema = z.object({
  type: z.literal("agent.thinking_text").default("agent.thinking_text"),
  session_id: z.string(),
  run_id: z.string(),
  text: z.string(),
  timestamp: z.string(),
});
export type ThinkingTextEvent = z.infer<typeof ThinkingTextEventSchema>;

export const ThinkingCompleteEventSchema = z.object({
  type: z.literal("agent.thinking_complete").default("agent.thinking_complete"),
  session_id: z.string(),
  run_id: z.string(),
  thinking: z.string(),
  timestamp: z.string(),
});
export type ThinkingCompleteEvent = z.infer<typeof ThinkingCompleteEventSchema>;

export const ToolUseEventSchema = z.object({
  type: z.literal("agent.tool_use").default("agent.tool_use"),
  session_id: z.string(),
  run_id: z.string(),
  tool_id: z.string(),
  tool_name: z.string(),
  args: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});
export type ToolUseEvent = z.infer<typeof ToolUseEventSchema>;

export const ToolResultEventSchema = z.object({
  type: z.literal("agent.tool_result").default("agent.tool_result"),
  session_id: z.string(),
  run_id: z.string(),
  tool_id: z.string(),
  tool_name: z.string(),
  output: z.string(),
  is_error: z.boolean().default(false),
  elapsed_ms: z.number().int(),
  timestamp: z.string(),
});
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;

export const TurnCompleteEventSchema = z.object({
  type: z.literal("agent.turn_complete").default("agent.turn_complete"),
  session_id: z.string(),
  run_id: z.string(),
  turn: z.number().int(),
  timestamp: z.string(),
});
export type TurnCompleteEvent = z.infer<typeof TurnCompleteEventSchema>;

export const LoopCompleteEventSchema = z.object({
  type: z.literal("agent.loop_complete").default("agent.loop_complete"),
  session_id: z.string(),
  run_id: z.string(),
  stop_reason: z.string(),
  total_turns: z.number().int(),
  elapsed_ms: z.number().int(),
  timestamp: z.string(),
});
export type LoopCompleteEvent = z.infer<typeof LoopCompleteEventSchema>;

export const UsageEventSchema = z.object({
  type: z.literal("agent.usage").default("agent.usage"),
  session_id: z.string(),
  run_id: z.string(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int().default(0),
  cache_creation_input_tokens: z.number().int().default(0),
  timestamp: z.string(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

export const RetryEventSchema = z.object({
  type: z.literal("agent.retry").default("agent.retry"),
  session_id: z.string(),
  run_id: z.string(),
  reason: z.string(),
  delay_ms: z.number().int(),
  timestamp: z.string(),
});
export type RetryEvent = z.infer<typeof RetryEventSchema>;

export const CompactEventSchema = z.object({
  type: z.literal("agent.compact").default("agent.compact"),
  session_id: z.string(),
  run_id: z.string(),
  message: z.string(),
  timestamp: z.string(),
});
export type CompactEvent = z.infer<typeof CompactEventSchema>;

export const AgentErrorEventSchema = z.object({
  type: z.literal("agent.error").default("agent.error"),
  session_id: z.string(),
  run_id: z.string(),
  message: z.string(),
  timestamp: z.string(),
});
export type AgentErrorEvent = z.infer<typeof AgentErrorEventSchema>;

// ---- Interaction requests (answered via *.respond RPCs) ----

export const PermissionRequestedEventSchema = z.object({
  type: z.literal("permission.requested").default("permission.requested"),
  id: z.string(),
  session_id: z.string(),
  run_id: z.string().default(""),
  tool_name: z.string(),
  args: z.record(z.string(), z.unknown()),
  // Human-readable reason from the permission checker's Decision
  reason: z.string().default(""),
  timestamp: z.string(),
});
export type PermissionRequestedEvent = z.infer<typeof PermissionRequestedEventSchema>;

// Emitted after a pending permission settles (client answer, timeout, or
// disconnect) so every subscribed client can clear its dialog.
export const PermissionResolvedEventSchema = z.object({
  type: z.literal("permission.resolved").default("permission.resolved"),
  id: z.string(),
  session_id: z.string(),
  response: z.string(),
  // .catch(): unknown future sources degrade to "client" on old clients
  // instead of failing the whole event parse (which would strand dialogs).
  source: z.enum(["client", "timeout", "disconnect", "abort"]).catch("client"),
  timestamp: z.string(),
});
export type PermissionResolvedEvent = z.infer<typeof PermissionResolvedEventSchema>;

export const AskUserRequestedEventSchema = z.object({
  type: z.literal("ask_user.requested").default("ask_user.requested"),
  id: z.string(),
  session_id: z.string(),
  run_id: z.string().default(""),
  questions: z.array(WireQuestionSchema),
  timestamp: z.string(),
});
export type AskUserRequestedEvent = z.infer<typeof AskUserRequestedEventSchema>;

export const AskUserResolvedEventSchema = z.object({
  type: z.literal("ask_user.resolved").default("ask_user.resolved"),
  id: z.string(),
  session_id: z.string(),
  timestamp: z.string(),
});
export type AskUserResolvedEvent = z.infer<typeof AskUserResolvedEventSchema>;

export const PlanRequestedEventSchema = z.object({
  type: z.literal("plan.requested").default("plan.requested"),
  id: z.string(),
  session_id: z.string(),
  plan_text: z.string().default(""),
  timestamp: z.string(),
});
export type PlanRequestedEvent = z.infer<typeof PlanRequestedEventSchema>;

export const PlanResolvedEventSchema = z.object({
  type: z.literal("plan.resolved").default("plan.resolved"),
  id: z.string(),
  session_id: z.string(),
  choice: z.string(),
  timestamp: z.string(),
});
export type PlanResolvedEvent = z.infer<typeof PlanResolvedEventSchema>;

// ---- State pushes ----

export const ModeChangedEventSchema = z.object({
  type: z.literal("mode.changed").default("mode.changed"),
  session_id: z.string(),
  mode: z.string(),
  timestamp: z.string(),
});
export type ModeChangedEvent = z.infer<typeof ModeChangedEventSchema>;

export const TodoUpdatedEventSchema = z.object({
  type: z.literal("todo.updated").default("todo.updated"),
  session_id: z.string(),
  todos: z.array(z.record(z.string(), z.unknown())),
  timestamp: z.string(),
});
export type TodoUpdatedEvent = z.infer<typeof TodoUpdatedEventSchema>;

export const TeammateStateEventSchema = z.object({
  type: z.literal("teammate.state").default("teammate.state"),
  session_id: z.string(),
  states: z.array(z.record(z.string(), z.unknown())),
  timestamp: z.string(),
});
export type TeammateStateEvent = z.infer<typeof TeammateStateEventSchema>;

export const SubagentProgressEventSchema = z.object({
  type: z.literal("subagent.progress").default("subagent.progress"),
  session_id: z.string(),
  task_id: z.string(),
  description: z.string(),
  status: z.string(),
  detail: z.string().default(""),
  timestamp: z.string(),
});
export type SubagentProgressEvent = z.infer<typeof SubagentProgressEventSchema>;

// ---- Command / system output ----

// Output line from daemon-side slash commands or system notices.
export const SystemMessageEventSchema = z.object({
  type: z.literal("system.message").default("system.message"),
  session_id: z.string(),
  message: z.string(),
  timestamp: z.string(),
});
export type SystemMessageEvent = z.infer<typeof SystemMessageEventSchema>;

// Marks the end of a command.run output stream.
export const CommandDoneEventSchema = z.object({
  type: z.literal("command.done").default("command.done"),
  session_id: z.string(),
  timestamp: z.string(),
});
export type CommandDoneEvent = z.infer<typeof CommandDoneEventSchema>;

// Instructs clients to clear their transcript view (e.g. /clear).
export const UiClearEventSchema = z.object({
  type: z.literal("ui.clear").default("ui.clear"),
  session_id: z.string(),
  timestamp: z.string(),
});
export type UiClearEvent = z.infer<typeof UiClearEventSchema>;

// Transcript replay lines (e.g. /resume): role is "user" | "assistant".
export const ReplayMessageEventSchema = z.object({
  type: z.literal("replay.message").default("replay.message"),
  session_id: z.string(),
  role: z.string(),
  content: z.string(),
  timestamp: z.string(),
});
export type ReplayMessageEvent = z.infer<typeof ReplayMessageEventSchema>;

// Discriminated union of all event types based on the type field
export const EventSchema = z.discriminatedUnion("type", [
  CoreStartedEventSchema,
  LogLineEventSchema,
  SessionCreatedEventSchema,
  SessionClosedEventSchema,
  RunStartedEventSchema,
  StreamTextEventSchema,
  ThinkingTextEventSchema,
  ThinkingCompleteEventSchema,
  ToolUseEventSchema,
  ToolResultEventSchema,
  TurnCompleteEventSchema,
  LoopCompleteEventSchema,
  UsageEventSchema,
  RetryEventSchema,
  CompactEventSchema,
  AgentErrorEventSchema,
  PermissionRequestedEventSchema,
  PermissionResolvedEventSchema,
  AskUserRequestedEventSchema,
  AskUserResolvedEventSchema,
  PlanRequestedEventSchema,
  PlanResolvedEventSchema,
  ModeChangedEventSchema,
  TodoUpdatedEventSchema,
  TeammateStateEventSchema,
  SubagentProgressEventSchema,
  SystemMessageEventSchema,
  CommandDoneEventSchema,
  UiClearEventSchema,
  ReplayMessageEventSchema,
]);

export type Event = z.infer<typeof EventSchema>;
