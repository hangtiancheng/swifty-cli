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

// Restore Session from meta.json object
export function sessionFromDict(data: Record<string, unknown>): Session {
  const modeRaw = data["mode"];
  const statusRaw = data["status"];
  const titleRaw = data["title"];
  const runIdsRaw = data["run_ids"];
  return {
    id: String(data["id"]),
    mode: modeRaw === "one_shot" || modeRaw === "chat" ? modeRaw : "chat",
    status:
      statusRaw === "active" || statusRaw === "waiting_for_input" || statusRaw === "closed"
        ? statusRaw
        : "active",
    title: typeof titleRaw === "string" ? titleRaw : "",
    createdAt: String(data["created_at"]),
    updatedAt: String(data["updated_at"]),
    runIds: Array.isArray(runIdsRaw) ? runIdsRaw.map(String) : [],
  };
}
