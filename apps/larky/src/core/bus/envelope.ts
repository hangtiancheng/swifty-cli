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

// JSON-RPC 2.0 frame definitions, error codes, and utility functions
import { z } from "zod";

// JSON-RPC 2.0 request frame
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0").default("2.0"),
  id: z.string(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

// JSON-RPC 2.0 error object
export const JsonRpcErrorObjectSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().nullish(),
});

export type JsonRpcErrorObject = z.infer<typeof JsonRpcErrorObjectSchema>;

// JSON-RPC 2.0 success response frame
export const JsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0").default("2.0"),
  id: z.string(),
  result: z.unknown(),
});

export type JsonRpcSuccess = z.infer<typeof JsonRpcSuccessSchema>;

// JSON-RPC 2.0 error response frame
export const JsonRpcErrorSchema = z.object({
  jsonrpc: z.literal("2.0").default("2.0"),
  id: z.string().nullable(),
  error: JsonRpcErrorObjectSchema,
});

export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

// Server-pushed event envelope
export const EventPushEnvelopeSchema = z.object({
  kind: z.literal("event").default("event"),
  event: z.record(z.string(), z.unknown()),
});

export type EventPushEnvelope = z.infer<typeof EventPushEnvelopeSchema>;

// JSON-RPC 2.0 standard error codes
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

// Thrown by command handlers; SocketServer converts this to a structured JSON-RPC error response
export class HandlerError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "HandlerError";
    this.code = code;
    this.data = data ?? null;
  }
}

// Construct a JSON-RPC error response object
export function makeError(
  id: string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data: data ?? null },
  };
}

// Type-safe check: narrow unknown to Record<string, unknown>
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
