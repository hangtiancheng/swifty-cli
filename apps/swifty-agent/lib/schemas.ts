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

import { z } from "zod/v4";

// Unified API response shape { message, data }, used by the client hook to
// parse fetch responses with zod instead of type assertions. Mirrors the
// shapes returned by the route handlers in app/api/*.

export const chatResponseSchema = z.object({
  message: z.string(),
  data: z.object({ answer: z.string() }).optional(),
});

export const aiOpsResponseSchema = z.object({
  message: z.string(),
  data: z
    .object({
      result: z.string(),
      detail: z.array(z.string()).optional(),
    })
    .optional(),
});

export const uploadResponseSchema = z.object({
  message: z.string(),
  data: z.unknown().optional(),
});
