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

// bus module unified exports
export {
  JsonRpcRequestSchema,
  JsonRpcSuccessSchema,
  JsonRpcErrorSchema,
  JsonRpcErrorObjectSchema,
  EventPushEnvelopeSchema,
  HandlerError,
  makeError,
  PARSE_ERROR,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
} from "./envelope.js";

export type {
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonRpcError,
  JsonRpcErrorObject,
  EventPushEnvelope,
} from "./envelope.js";

export {
  CommandSchema,
  PingCommandSchema,
  PongResultSchema,
  AgentRunCommandSchema,
  AgentRunResultSchema,
  EventSubscribeCommandSchema,
  EventSubscribeResultSchema,
  SessionCreateCommandSchema,
  SessionCreateResultSchema,
  SessionSendMessageCommandSchema,
  SessionSendMessageResultSchema,
  SessionGetHistoryCommandSchema,
  SessionGetHistoryResultSchema,
  SessionCloseCommandSchema,
  SessionCloseResultSchema,
  PermissionRespondCommandSchema,
  PermissionRespondResultSchema,
  SessionCompactCommandSchema,
  SessionCompactResultSchema,
  SessionModeSchema,
  SessionStatusSchema,
} from "./commands.js";

export type {
  Command,
  PingCommand,
  PongResult,
  AgentRunCommand,
  AgentRunResult,
  EventSubscribeCommand,
  EventSubscribeResult,
  SessionCreateCommand,
  SessionCreateResult,
  SessionSendMessageCommand,
  SessionSendMessageResult,
  SessionGetHistoryCommand,
  SessionGetHistoryResult,
  SessionCloseCommand,
  SessionCloseResult,
  PermissionRespondCommand,
  PermissionRespondResult,
  SessionCompactCommand,
  SessionCompactResult,
  SessionMode,
  SessionStatus,
} from "./commands.js";

export {
  EventSchema,
  CoreStartedEventSchema,
  RunStartedEventSchema,
  RunFinishedEventSchema,
  StepStartedEventSchema,
  StepFinishedEventSchema,
  ToolUseStartedEventSchema,
  ToolUseFinishedEventSchema,
  ToolUseFailedEventSchema,
  LlmTokenEventSchema,
  LlmUsageEventSchema,
  LlmModelSelectedEventSchema,
  LogLineEventSchema,
  SessionCreatedEventSchema,
  SessionMessageReceivedEventSchema,
  SessionWaitingForInputEventSchema,
  SessionResumedEventSchema,
  SessionClosedEventSchema,
  ContextCompactedEventSchema,
  PermissionRequestedEventSchema,
  PermissionGrantedEventSchema,
  PermissionDeniedEventSchema,
  SubagentStartedEventSchema,
  SubagentFinishedEventSchema,
  SkillInvokedEventSchema,
} from "./events.js";

export type {
  Event,
  CoreStartedEvent,
  RunStartedEvent,
  RunFinishedEvent,
  StepStartedEvent,
  StepFinishedEvent,
  ToolUseStartedEvent,
  ToolUseFinishedEvent,
  ToolUseFailedEvent,
  LlmTokenEvent,
  LlmUsageEvent,
  LlmModelSelectedEvent,
  LogLineEvent,
  SessionCreatedEvent,
  SessionMessageReceivedEvent,
  SessionWaitingForInputEvent,
  SessionResumedEvent,
  SessionClosedEvent,
  ContextCompactedEvent,
  PermissionRequestedEvent,
  PermissionGrantedEvent,
  PermissionDeniedEvent,
  SubagentStartedEvent,
  SubagentFinishedEvent,
  SkillInvokedEvent,
} from "./events.js";
