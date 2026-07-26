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

// Pending-interaction hub: the daemon side of the blocking UI callbacks
// (permission / ask-user / plan approval). Each pending entry settles exactly
// once — first of: client respond, run abort, disconnect, session close —
// with Map.delete() as the mutual-exclusion point. Extracted from CoreApp so
// it is unit-testable without reaching into private state.
import { randomUUID } from "node:crypto";

import type { Decision } from "../permissions/checker.js";
import type { Question } from "../tools/ask-user.js";

import type { Event } from "./bus/events.js";
import type { WirePlanChoice } from "./bus/commands.js";

/** The slice of AgentSession the hub needs (structural, test-friendly). */
export interface InteractionSessionRef {
  readonly id: string;
  readonly currentRunId: string | null;
}

export type PermissionResponse = "allow" | "deny" | "allowAlways";
export type PermissionResolvedSource =
  | "client"
  | "timeout"
  | "disconnect"
  | "abort"
  | "session_closed";

interface PendingPermission {
  sessionId: string;
  runId: string;
  resolve: (r: PermissionResponse) => void;
  cleanup?: () => void;
}

interface PendingAsk {
  sessionId: string;
  runId: string;
  resolve: (answers: Record<string, string>) => void;
  reject: (e: Error) => void;
  cleanup?: () => void;
}

interface PendingPlan {
  sessionId: string;
  runId: string;
  resolve: (r: { choice: WirePlanChoice; feedback: string }) => void;
  reject: (e: Error) => void;
  cleanup?: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class InteractionHub {
  private pendingPermissions = new Map<string, PendingPermission>();
  private pendingAsks = new Map<string, PendingAsk>();
  private pendingPlans = new Map<string, PendingPlan>();

  constructor(private emit: (event: Event) => void) {}

  get pendingCounts(): { permissions: number; asks: number; plans: number } {
    return {
      permissions: this.pendingPermissions.size,
      asks: this.pendingAsks.size,
      plans: this.pendingPlans.size,
    };
  }

  // -- Broker methods (satisfy InteractionBroker structurally) ---------------

  requestPermission(
    session: InteractionSessionRef,
    toolName: string,
    args: Record<string, unknown>,
    decision: Decision,
    signal?: AbortSignal,
  ): Promise<PermissionResponse> {
    const id = `perm-${randomUUID().slice(0, 8)}`;
    return new Promise<PermissionResponse>((resolve) => {
      if (signal?.aborted) {
        resolve("deny");
        return;
      }
      const onAbort = () => {
        this.settlePermission(id, "deny", "abort");
      };
      this.pendingPermissions.set(id, {
        sessionId: session.id,
        runId: session.currentRunId ?? "",
        resolve,
        cleanup: () => {
          signal?.removeEventListener("abort", onAbort);
        },
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.emit({
        type: "permission.requested",
        id,
        session_id: session.id,
        run_id: session.currentRunId ?? "",
        tool_name: toolName,
        args,
        reason: decision.reason,
        timestamp: nowIso(),
      });
    });
  }

  askUser(
    session: InteractionSessionRef,
    questions: Question[],
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    const id = `ask-${randomUUID().slice(0, 8)}`;
    return new Promise<Record<string, string>>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("interrupted"));
        return;
      }
      const onAbort = () => {
        // Reject so the executor records an isError tool_result, keeping
        // the tool_use/tool_result pairing intact.
        this.settleAsk(id, { error: new Error("interrupted") });
      };
      this.pendingAsks.set(id, {
        sessionId: session.id,
        runId: session.currentRunId ?? "",
        resolve,
        reject,
        cleanup: () => {
          signal?.removeEventListener("abort", onAbort);
        },
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.emit({
        type: "ask_user.requested",
        id,
        session_id: session.id,
        run_id: session.currentRunId ?? "",
        questions: questions.map((q) => ({
          question: q.question,
          header: q.header,
          options: q.options.map((o) => ({
            label: o.label,
            ...(o.description !== undefined ? { description: o.description } : {}),
          })),
          multiSelect: q.multiSelect,
        })),
        timestamp: nowIso(),
      });
    });
  }

  requestPlanApproval(
    session: InteractionSessionRef,
    planText: string,
    signal?: AbortSignal,
  ): Promise<{ choice: WirePlanChoice; feedback: string }> {
    const id = `plan-${randomUUID().slice(0, 8)}`;
    return new Promise<{ choice: WirePlanChoice; feedback: string }>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("interrupted"));
        return;
      }
      const onAbort = () => {
        this.settlePlan(id, { error: new Error("interrupted") });
      };
      this.pendingPlans.set(id, {
        sessionId: session.id,
        runId: session.currentRunId ?? "",
        resolve,
        reject,
        cleanup: () => {
          signal?.removeEventListener("abort", onAbort);
        },
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.emit({
        type: "plan.requested",
        id,
        session_id: session.id,
        run_id: session.currentRunId ?? "",
        plan_text: planText,
        timestamp: nowIso(),
      });
    });
  }

  // -- Client responses (idempotent: unknown/duplicate ids are ignored) ------

  respondPermission(id: string, response: PermissionResponse): void {
    this.settlePermission(id, response, "client");
  }

  respondAsk(id: string, answers: Record<string, string>): void {
    this.settleAsk(id, { answers });
  }

  respondPlan(id: string, choice: WirePlanChoice, feedback: string): void {
    this.settlePlan(id, { choice, feedback });
  }

  // -- Bulk cancellation ------------------------------------------------------

  /** Cancel everything (e.g. the last client disconnected — B-3). */
  cancelAll(): void {
    for (const id of [...this.pendingPermissions.keys()]) {
      this.settlePermission(id, "deny", "disconnect");
    }
    for (const id of [...this.pendingAsks.keys()]) {
      this.settleAsk(id, { answers: {} });
    }
    for (const id of [...this.pendingPlans.keys()]) {
      this.settlePlan(id, { error: new Error("client disconnected") });
    }
  }

  /**
   * Settle every pending interaction owned by a closing session so its
   * resolvers never leak and clients drop the stranded dialogs.
   */
  cancelForSession(sessionId: string): void {
    for (const [id, p] of [...this.pendingPermissions]) {
      if (p.sessionId === sessionId) {
        this.settlePermission(id, "deny", "session_closed");
      }
    }
    for (const [id, p] of [...this.pendingAsks]) {
      if (p.sessionId === sessionId) {
        this.settleAsk(id, { error: new Error("session closed") });
      }
    }
    for (const [id, p] of [...this.pendingPlans]) {
      if (p.sessionId === sessionId) {
        this.settlePlan(id, { error: new Error("session closed") });
      }
    }
  }

  hasPendingFor(sessionId: string): boolean {
    for (const p of this.pendingPermissions.values()) {
      if (p.sessionId === sessionId) {
        return true;
      }
    }
    for (const p of this.pendingAsks.values()) {
      if (p.sessionId === sessionId) {
        return true;
      }
    }
    for (const p of this.pendingPlans.values()) {
      if (p.sessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  // -- Settlement (exactly-once via Map.delete) --------------------------------

  private settlePermission(
    id: string,
    response: PermissionResponse,
    source: PermissionResolvedSource,
  ): void {
    const pending = this.pendingPermissions.get(id);
    if (!pending || !this.pendingPermissions.delete(id)) {
      return;
    }
    pending.cleanup?.();
    pending.resolve(response);
    this.emit({
      type: "permission.resolved",
      id,
      session_id: pending.sessionId,
      run_id: pending.runId,
      response,
      source,
      timestamp: nowIso(),
    });
  }

  private settleAsk(
    id: string,
    outcome: { answers: Record<string, string> } | { error: Error },
  ): void {
    const pending = this.pendingAsks.get(id);
    if (!pending || !this.pendingAsks.delete(id)) {
      return;
    }
    pending.cleanup?.();
    if ("answers" in outcome) {
      pending.resolve(outcome.answers);
    } else {
      pending.reject(outcome.error);
    }
    this.emit({
      type: "ask_user.resolved",
      id,
      session_id: pending.sessionId,
      run_id: pending.runId,
      timestamp: nowIso(),
    });
  }

  private settlePlan(
    id: string,
    outcome: { choice: WirePlanChoice; feedback: string } | { error: Error },
  ): void {
    const pending = this.pendingPlans.get(id);
    if (!pending || !this.pendingPlans.delete(id)) {
      return;
    }
    pending.cleanup?.();
    if ("error" in outcome) {
      pending.reject(outcome.error);
    } else {
      pending.resolve(outcome);
    }
    this.emit({
      type: "plan.resolved",
      id,
      session_id: pending.sessionId,
      run_id: pending.runId,
      choice: "error" in outcome ? "cancelled" : outcome.choice,
      timestamp: nowIso(),
    });
  }
}
