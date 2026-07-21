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

// Shared core error types
import { APIUserAbortError } from "@anthropic-ai/sdk";

// Thrown when a run is cancelled via AbortSignal. Message stays "cancelled"
// for backwards compatibility with callers that match on the message string.
export class RunCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "RunCancelledError";
  }
}

// True if the error represents a user/system abort (never a real LLM failure):
// our own RunCancelledError, the Anthropic SDK's APIUserAbortError (thrown when
// a request-level AbortSignal fires mid-stream), or a generic DOM AbortError.
export function isAbortError(exc: unknown): boolean {
  if (exc instanceof RunCancelledError) return true;
  if (exc instanceof APIUserAbortError) return true;
  return exc instanceof Error && exc.name === "AbortError";
}
