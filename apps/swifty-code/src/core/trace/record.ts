// Trace record data model and typed factory functions
import { z } from "zod";

export const TraceDirectionSchema = z.enum([
  "CLIENT→CORE",
  "CORE→CLIENT",
  "CORE",
  "CORE→LLM",
  "LLM→CORE",
]);
export type TraceDirection = z.infer<typeof TraceDirectionSchema>;

export const TraceLayerSchema = z.enum(["ipc", "event", "llm"]);
export type TraceLayer = z.infer<typeof TraceLayerSchema>;

export const TraceRecordSchema = z.object({
  ts: z.string(),
  direction: TraceDirectionSchema,
  layer: TraceLayerSchema,
  kind: z.string(),
  run_id: z.string().nullable().default(null),
  step: z.number().int().nullable().default(null),
  client_id: z.string().nullable().default(null),
  data: z.record(z.string(), z.unknown()),
});
export type TraceRecord = z.infer<typeof TraceRecordSchema>;

function ts(): string {
  return new Date().toISOString();
}

// IPC layer: CLIENT→CORE command (includes request id for correlation)
export function makeCommandTrace(
  clientId: string,
  method: string,
  id: string,
  params: Record<string, unknown>,
): TraceRecord {
  return {
    ts: ts(),
    direction: "CLIENT→CORE",
    layer: "ipc",
    kind: "command",
    run_id: null,
    step: null,
    client_id: clientId,
    data: { method, id, params },
  };
}

// IPC layer: CORE→CLIENT successful response
export function makeResponseTrace(
  clientId: string,
  method: string,
  id: string,
  result: unknown,
): TraceRecord {
  return {
    ts: ts(),
    direction: "CORE→CLIENT",
    layer: "ipc",
    kind: "response",
    run_id: null,
    step: null,
    client_id: clientId,
    data: { method, id, result },
  };
}

// IPC layer: CORE→CLIENT error response
export function makeErrorTrace(
  clientId: string,
  method: string,
  error: string,
  id?: string,
): TraceRecord {
  return {
    ts: ts(),
    direction: "CORE→CLIENT",
    layer: "ipc",
    kind: "error",
    run_id: null,
    step: null,
    client_id: clientId,
    data: id !== undefined ? { method, id, error } : { method, error },
  };
}

// IPC layer: CORE→CLIENT event push to subscriber
export function makePushTrace(
  clientId: string,
  runId: string | null,
  subId: string,
  eventType: string,
): TraceRecord {
  return {
    ts: ts(),
    direction: "CORE→CLIENT",
    layer: "ipc",
    kind: "push",
    run_id: runId,
    step: null,
    client_id: clientId,
    data: { sub_id: subId, event_type: eventType },
  };
}

// Event layer: internal EventBus event
export function makeEventTrace(
  runId: string | null,
  eventData: Record<string, unknown>,
): TraceRecord {
  return {
    ts: ts(),
    direction: "CORE",
    layer: "event",
    kind: "event",
    run_id: runId,
    step: null,
    client_id: null,
    data: eventData,
  };
}

// LLM layer: CORE→LLM API request
export function makeApiCallTrace(
  runId: string,
  step: number,
  data: Record<string, unknown>,
): TraceRecord {
  return {
    ts: ts(),
    direction: "CORE→LLM",
    layer: "llm",
    kind: "api_call",
    run_id: runId,
    step,
    client_id: null,
    data,
  };
}

// LLM layer: LLM→CORE API response
export function makeApiResponseTrace(
  runId: string,
  step: number,
  data: Record<string, unknown>,
): TraceRecord {
  return {
    ts: ts(),
    direction: "LLM→CORE",
    layer: "llm",
    kind: "api_response",
    run_id: runId,
    step,
    client_id: null,
    data,
  };
}
