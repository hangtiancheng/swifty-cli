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

// Custom error serializer for pino.
// The default pino err serializer does not recurse into Error.cause chains
// and does not handle non-Error values. This module fills those gaps:
// recursive cause (max 5 levels), preserves extra fields, tolerates non-Error.

/** Serialized error shape: always has type/message/stack, optional cause + extras. */
export interface SerializedError {
  type: string;
  message: string;
  stack?: string;
  cause?: SerializedError | { message: string };
  [key: string]: unknown;
}

const CAUSE_MAX_DEPTH = 5;
const RESERVED_KEYS = new Set(["name", "message", "stack", "cause"]);

/** Recursively serialize an Error instance (including its cause chain). */
function serializeErrorInstance(err: Error, depth: number): SerializedError {
  const out: SerializedError = {
    type: err.name,
    message: err.message,
    stack: err.stack,
  };

  // Recursive cause chain, guard against circular references.
  // Use getOwnPropertyDescriptor to read `cause` without type assertions
  // (Error.cause is not present on older TS lib definitions).
  const causeDescriptor = Object.getOwnPropertyDescriptor(err, "cause");
  if (causeDescriptor && depth < CAUSE_MAX_DEPTH) {
    const cause: unknown = causeDescriptor.value;
    if (cause instanceof Error) {
      out.cause = serializeErrorInstance(cause, depth + 1);
    } else if (cause !== undefined) {
      out.cause = {
        message: typeof cause === "string" ? cause : JSON.stringify(cause),
      };
    }
  }

  // Preserve extra fields (code, errno, statusCode, path, etc.) that Error
  // subclasses may attach. Read via getOwnPropertyDescriptor to avoid
  // unsafe member access on the Error type.
  for (const key of Object.keys(err)) {
    if (RESERVED_KEYS.has(key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(err, key);
    if (descriptor) {
      const fieldValue: unknown = descriptor.value;
      out[key] = fieldValue;
    }
  }

  return out;
}

/**
 * pino err serializer: tolerates Error instances and non-Error values.
 * - Error instance: recursive cause chain + preserved extra fields.
 * - string/undefined/plain object: normalized to { message, value }.
 */
export function errSerializer(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return serializeErrorInstance(err, 0);
  }
  return { message: String(err), value: err };
}
