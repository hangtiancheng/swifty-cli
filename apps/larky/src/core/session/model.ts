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

// Session data model
import { z } from "zod";

import { SessionModeSchema, SessionStatusSchema } from "../bus/commands.js";
import type { SessionMode, SessionStatus } from "../bus/commands.js";

export type { SessionMode, SessionStatus };

export interface Session {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  title: string;
  createdAt: string;
  updatedAt: string;
  runIds: string[];
}

// Create a new Session
export function createSession(id: string, mode: SessionMode, title: string): Session {
  const ts = new Date().toISOString();
  return {
    id,
    mode,
    status: "active",
    title,
    createdAt: ts,
    updatedAt: ts,
    runIds: [],
  };
}

// Serialize Session to object for meta.json persistence
export function sessionToDict(s: Session): Record<string, unknown> {
  return {
    id: s.id,
    mode: s.mode,
    status: s.status,
    title: s.title,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    run_ids: [...s.runIds],
  };
}

// Persisted meta.json shape. mode/status are strict (corrupted data must
// surface as an error); all other fields are leniently coerced or defaulted,
// matching the historical String()/typeof fallbacks.
const SessionDictSchema = z.object({
  id: z.coerce.string(),
  mode: SessionModeSchema,
  status: SessionStatusSchema,
  title: z.string().catch(""),
  created_at: z.coerce.string(),
  updated_at: z.coerce.string(),
  run_ids: z.array(z.coerce.string()).catch([]),
});

// Restore Session from meta.json object.
// Throws on invalid mode/status so corrupted persisted data is surfaced
// instead of being silently coerced to defaults.
export function sessionFromDict(data: Record<string, unknown>): Session {
  const parsed = SessionDictSchema.safeParse(data);
  if (!parsed.success) {
    // Only mode/status can fail (every other field coerces or defaults);
    // report mode first to preserve the historical check order
    if (parsed.error.issues.some((issue) => issue.path[0] === "mode")) {
      throw new Error(`Invalid session mode: ${String(data["mode"])}`);
    }
    throw new Error(`Invalid session status: ${String(data["status"])}`);
  }
  const d = parsed.data;
  return {
    id: d.id,
    mode: d.mode,
    status: d.status,
    title: d.title,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    runIds: d.run_ids,
  };
}
