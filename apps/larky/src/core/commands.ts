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

// Wire protocol RPC command/result schemas (client → daemon), routed by the
// JSON-RPC `method`; the `type` field mirrors the method for doc generation.
import { z } from "zod";

// ---- Shared enums ----

// Permission modes mirror larky's PermissionChecker modes.
export const PermissionModeSchema = z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]);
export type WirePermissionMode = z.infer<typeof PermissionModeSchema>;

// Responses a client can give to a permission_request.
export const PermissionResponseSchema = z.enum(["allow", "deny", "allowAlways"]);
export type WirePermissionResponse = z.infer<typeof PermissionResponseSchema>;

// Plan-approval choices mirror the TUI PlanApprovalDialog.
export const PlanChoiceSchema = z.enum(["yolo", "manual", "feedback"]);
export type WirePlanChoice = z.infer<typeof PlanChoiceSchema>;

// Slash command descriptor for client-side autocomplete.
export const CommandInfoSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  aliases: z.array(z.string()).default([]),
});
export type CommandInfo = z.infer<typeof CommandInfoSchema>;

// ---- core.ping ----

export const PingCommandSchema = z.object({
  type: z.literal("core.ping").default("core.ping"),
  client: z.string(),
});
export type PingCommand = z.infer<typeof PingCommandSchema>;

export const PongResultSchema = z.object({
  server_version: z.string(),
  uptime_ms: z.number().int(),
  received_at: z.string(),
});
export type PongResult = z.infer<typeof PongResultSchema>;

// ---- core.status ----

export const CoreStatusCommandSchema = z.object({
  type: z.literal("core.status").default("core.status"),
});
export type CoreStatusCommand = z.infer<typeof CoreStatusCommandSchema>;

export const CoreStatusResultSchema = z.object({
  server_version: z.string(),
  uptime_ms: z.number().int(),
  cwd: z.string(),
  active_sessions: z.number().int(),
});
export type CoreStatusResult = z.infer<typeof CoreStatusResultSchema>;

// ---- event.subscribe ----

export const EventSubscribeCommandSchema = z.object({
  type: z.literal("event.subscribe").default("event.subscribe"),
  topics: z.array(z.string()),
  // "global" | "session:<id>" | "run:<id>"
  scope: z.string().default("global"),
  replay_from_run: z.string().nullable().default(null),
  // Replay cursor: skip this many already-applied matching lines so a brief
  // reconnect does not re-render the whole run.
  replay_offset: z.number().int().nonnegative().default(0),
});
export type EventSubscribeCommand = z.infer<typeof EventSubscribeCommandSchema>;

export const EventSubscribeResultSchema = z.object({
  subscription_id: z.string(),
  replayed_count: z.number().int().default(0),
});
export type EventSubscribeResult = z.infer<typeof EventSubscribeResultSchema>;

// ---- session.create ----

export const SessionCreateCommandSchema = z.object({
  type: z.literal("session.create").default("session.create"),
  permission_mode: PermissionModeSchema.nullable().default(null),
  // Provider chosen by the client (config provider name); daemon falls back
  // to the first configured provider when absent or unknown.
  provider_name: z.string().nullable().default(null),
  // Persist conversation to a session file (disabled by print mode).
  persist: z.boolean().default(true),
});
export type SessionCreateCommand = z.infer<typeof SessionCreateCommandSchema>;

export const SessionCreateResultSchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  permission_mode: PermissionModeSchema,
  commands: z.array(CommandInfoSchema).default([]),
});
export type SessionCreateResult = z.infer<typeof SessionCreateResultSchema>;

// ---- session.list (persisted larky sessions available for resume) ----

export const SessionListCommandSchema = z.object({
  type: z.literal("session.list").default("session.list"),
});
export type SessionListCommand = z.infer<typeof SessionListCommandSchema>;

export const SessionListResultSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      first_message: z.string(),
      message_count: z.number().int(),
      mod_time: z.string(),
    }),
  ),
});
export type SessionListResult = z.infer<typeof SessionListResultSchema>;

// ---- session.resume (rebuild live session from a persisted session file) ----

export const SessionResumeCommandSchema = z.object({
  type: z.literal("session.resume").default("session.resume"),
  session_id: z.string(),
  resume_id: z.string(),
});
export type SessionResumeCommand = z.infer<typeof SessionResumeCommandSchema>;

export const SessionResumeResultSchema = z.object({
  // Replayed transcript for client rendering: role is "user" | "assistant".
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});
export type SessionResumeResult = z.infer<typeof SessionResumeResultSchema>;

// ---- session.send_message ----

export const SessionSendMessageCommandSchema = z.object({
  type: z.literal("session.send_message").default("session.send_message"),
  session_id: z.string(),
  content: z.string(),
});
export type SessionSendMessageCommand = z.infer<typeof SessionSendMessageCommandSchema>;

// Returns immediately with the run id; progress arrives as events.
export const SessionSendMessageResultSchema = z.object({
  run_id: z.string(),
});
export type SessionSendMessageResult = z.infer<typeof SessionSendMessageResultSchema>;

// ---- session.close ----

export const SessionCloseCommandSchema = z.object({
  type: z.literal("session.close").default("session.close"),
  session_id: z.string(),
});
export type SessionCloseCommand = z.infer<typeof SessionCloseCommandSchema>;

export const SessionCloseResultSchema = z.object({
  ok: z.boolean().default(true),
});
export type SessionCloseResult = z.infer<typeof SessionCloseResultSchema>;

// ---- run.cancel (Esc / Ctrl+C interrupt) ----

export const RunCancelCommandSchema = z.object({
  type: z.literal("run.cancel").default("run.cancel"),
  session_id: z.string(),
});
export type RunCancelCommand = z.infer<typeof RunCancelCommandSchema>;

export const RunCancelResultSchema = z.object({
  ok: z.boolean().default(true),
  // false when no run was in flight
  cancelled: z.boolean().default(false),
});
export type RunCancelResult = z.infer<typeof RunCancelResultSchema>;

// ---- permission.respond ----

export const PermissionRespondCommandSchema = z.object({
  type: z.literal("permission.respond").default("permission.respond"),
  id: z.string(),
  response: PermissionResponseSchema,
});
export type PermissionRespondCommand = z.infer<typeof PermissionRespondCommandSchema>;

export const PermissionRespondResultSchema = z.object({
  ok: z.boolean().default(true),
});
export type PermissionRespondResult = z.infer<typeof PermissionRespondResultSchema>;

// ---- ask_user.respond ----

export const AskUserRespondCommandSchema = z.object({
  type: z.literal("ask_user.respond").default("ask_user.respond"),
  id: z.string(),
  // question text → chosen answer
  answers: z.record(z.string(), z.string()),
});
export type AskUserRespondCommand = z.infer<typeof AskUserRespondCommandSchema>;

export const AskUserRespondResultSchema = z.object({
  ok: z.boolean().default(true),
});
export type AskUserRespondResult = z.infer<typeof AskUserRespondResultSchema>;

// ---- plan.respond ----

export const PlanRespondCommandSchema = z.object({
  type: z.literal("plan.respond").default("plan.respond"),
  id: z.string(),
  choice: PlanChoiceSchema,
  feedback: z.string().default(""),
});
export type PlanRespondCommand = z.infer<typeof PlanRespondCommandSchema>;

export const PlanRespondResultSchema = z.object({
  ok: z.boolean().default(true),
});
export type PlanRespondResult = z.infer<typeof PlanRespondResultSchema>;

// ---- mode.set (shift+tab permission-mode cycling) ----

export const ModeSetCommandSchema = z.object({
  type: z.literal("mode.set").default("mode.set"),
  session_id: z.string(),
  mode: PermissionModeSchema,
});
export type ModeSetCommand = z.infer<typeof ModeSetCommandSchema>;

export const ModeSetResultSchema = z.object({
  ok: z.boolean().default(true),
  mode: PermissionModeSchema,
});
export type ModeSetResult = z.infer<typeof ModeSetResultSchema>;

// ---- command.run (daemon-side slash command execution) ----

export const CommandRunCommandSchema = z.object({
  type: z.literal("command.run").default("command.run"),
  session_id: z.string(),
  // Full slash command input, e.g. "/compact" or "/permission mode plan"
  input: z.string(),
});
export type CommandRunCommand = z.infer<typeof CommandRunCommandSchema>;

// Output is streamed as system.message events, terminated by command.done.
export const CommandRunResultSchema = z.object({
  accepted: z.boolean().default(true),
});
export type CommandRunResult = z.infer<typeof CommandRunResultSchema>;

// ---- command.list ----

export const CommandListCommandSchema = z.object({
  type: z.literal("command.list").default("command.list"),
  session_id: z.string(),
});
export type CommandListCommand = z.infer<typeof CommandListCommandSchema>;

export const CommandListResultSchema = z.object({
  commands: z.array(CommandInfoSchema),
});
export type CommandListResult = z.infer<typeof CommandListResultSchema>;

// ---- rewind.list / rewind.apply (file-history snapshots) ----

export const RewindListCommandSchema = z.object({
  type: z.literal("rewind.list").default("rewind.list"),
  session_id: z.string(),
});
export type RewindListCommand = z.infer<typeof RewindListCommandSchema>;

export const RewindSnapshotSchema = z.object({
  index: z.number().int(),
  message_index: z.number().int(),
  user_text: z.string(),
  file_count: z.number().int(),
  timestamp: z.string(),
});
export type RewindSnapshot = z.infer<typeof RewindSnapshotSchema>;

export const RewindListResultSchema = z.object({
  snapshots: z.array(RewindSnapshotSchema),
});
export type RewindListResult = z.infer<typeof RewindListResultSchema>;

export const RewindApplyCommandSchema = z.object({
  type: z.literal("rewind.apply").default("rewind.apply"),
  session_id: z.string(),
  index: z.number().int(),
  // "both" restores files and truncates the transcript; "files" restores
  // files only; "conversation" truncates the transcript only.
  mode: z.enum(["both", "files", "conversation"]).default("both"),
});
export type RewindApplyCommand = z.infer<typeof RewindApplyCommandSchema>;

export const RewindApplyResultSchema = z.object({
  ok: z.boolean().default(true),
  message: z.string().default(""),
});
export type RewindApplyResult = z.infer<typeof RewindApplyResultSchema>;

// Discriminated union of all command types based on the type field
export const CommandSchema = z.discriminatedUnion("type", [
  PingCommandSchema,
  CoreStatusCommandSchema,
  EventSubscribeCommandSchema,
  SessionCreateCommandSchema,
  SessionListCommandSchema,
  SessionResumeCommandSchema,
  SessionSendMessageCommandSchema,
  SessionCloseCommandSchema,
  RunCancelCommandSchema,
  PermissionRespondCommandSchema,
  AskUserRespondCommandSchema,
  PlanRespondCommandSchema,
  ModeSetCommandSchema,
  CommandRunCommandSchema,
  CommandListCommandSchema,
  RewindListCommandSchema,
  RewindApplyCommandSchema,
]);

export type Command = z.infer<typeof CommandSchema>;
