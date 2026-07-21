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

// Corresponds to /api/ai_ops (chat_v1_ai_ops.go).
// Runs the plan-execute-replan pipeline and returns { result, detail }.
import { runPlanExecuteReplan } from "@/lib/ai/pipelines/plan-execute-replan";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST() {
  try {
    for await (const event of runPlanExecuteReplan()) {
      if (event.type === "done") {
        return Response.json(
          {
            message: "OK",
            data: { result: event.result, detail: event.detail },
          },
          { headers: CORS_HEADERS },
        );
      }
      if (event.type === "error") {
        return Response.json(
          { message: event.error, data: null },
          { status: 500, headers: CORS_HEADERS },
        );
      }
    }
    // No done/error event emitted.
    return Response.json(
      { message: "internal error", data: null },
      { status: 500, headers: CORS_HEADERS },
    );
  } catch (e) {
    return Response.json(
      { message: e instanceof Error ? e.message : String(e), data: null },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
