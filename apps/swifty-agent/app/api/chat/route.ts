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

// Corresponds to /api/chat (chat_v1_chat.go).
// Unified response shape { message, data } mirrors ResponseMiddleware.
import { z } from "zod/v4";
import { chat } from "@/lib/ai/pipelines/chat";

const chatRequestSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const parsed = chatRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { message: "missing id or question", data: null },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const { id, question } = parsed.data;
    const answer = await chat(id, question);
    return Response.json({ message: "OK", data: { answer } }, { headers: CORS_HEADERS });
  } catch (e) {
    // The Vercel AI SDK throws APICallError with the real upstream body in
    // `responseBody`/`statusCode`; `e.message` alone is often empty when a
    // non-official Anthropic-compatible gateway returns a non-standard error.
    const err = e as {
      name?: string;
      message?: string;
      statusCode?: number;
      url?: string;
      responseBody?: string;
      responseHeaders?: Record<string, string>;
      cause?: unknown;
    };
    console.error("[/api/chat] error:", err);
    return Response.json(
      {
        message: JSON.stringify({
          name: err?.name,
          message: err?.message ?? String(e),
          statusCode: err?.statusCode,
          url: err?.url,
          responseBody: err?.responseBody,
          responseHeaders: err?.responseHeaders,
        }),
        data: null,
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
