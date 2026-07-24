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

// PermissionManager: policy evaluation, user approval gating, caching, and timeout
import { getLogger } from "../logging.js";
import {
  DEFAULT_POLICIES,
  type PermissionDecision,
  type ToolPolicy,
  evaluate,
  matchesOutsideCwd,
  paramPreview,
} from "./policy.js";
import { loadPolicyFile, savePolicyFile } from "./storage.js";

interface PendingRequest {
  resolve: (decision: string) => void;
  sessionId: string;
  toolName: string;
}

// Raised when a pending permission request exceeds its timeout
export class PermissionTimeoutError extends Error {
  constructor(ms: number) {
    super(`permission request timed out after ${String(ms)}ms`);
    this.name = "PermissionTimeoutError";
  }
}

// Session cache key: NUL separator cannot appear in session ids or tool names,
// so `${a}\u0000${b}` cannot collide across different (sessionId, toolName) pairs
function sessionCacheKey(sessionId: string, toolName: string): string {
  return `${sessionId}\u0000${toolName}`;
}

// Timeout utility for promises; guarantees the timer is cleared and no
// resolve/reject handler fires after the returned promise has settled
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new PermissionTimeoutError(ms));
    }, ms);
    promise
      .then((v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

// Manage tool call permissions: policy evaluation, user approval gating, session-level and persistent always-cache, timeout
export class PermissionManager {
  private _policies: Record<string, ToolPolicy>;
  private _pending = new Map<string, PendingRequest>();
  // (session_id, tool_name) → "allow" | "deny"
  private _sessionAlways = new Map<string, string>();
  private _policyFile: string | undefined;
  private _persistentAlways: Record<string, string>;
  private _timeoutS: number;

  constructor(options?: {
    policies?: Record<string, ToolPolicy>;
    policyFile?: string;
    timeoutS?: number;
  }) {
    this._policies = options?.policies ?? { ...DEFAULT_POLICIES };
    this._policyFile = options?.policyFile;
    this._persistentAlways = this._policyFile ? loadPolicyFile(this._policyFile) : {};
    this._timeoutS = options?.timeoutS ?? 60.0;
  }

  // Evaluate tool name + params through 4-tier static policy; does not suspend
  evaluate(toolName: string, params: Record<string, unknown>): PermissionDecision {
    // B-9: tool names are matched case-insensitively (defensive normalization)
    const policy = this._policies[toolName.toLowerCase()];
    return evaluate(toolName, params, policy);
  }

  // Check permissions; emit ask event to client and await response if needed; returns [allowed, decision_str]
  async checkAndWait(
    toolUseId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionId: string,
    eventEmitter: (event: Record<string, unknown>) => Promise<void>,
  ): Promise<[boolean, string]> {
    // B-9: tool names are matched case-insensitively — normalize once and use
    // the lowercased name for policy lookups and all cache keys (registered
    // tools are all-lowercase already; this is defensive normalization)
    const tool = toolName.toLowerCase();
    const commandRaw = params["command"];
    const command = tool === "bash" && typeof commandRaw === "string" ? commandRaw : "";
    const hasPolicy = tool in this._policies;
    const policy = this._policies[tool];

    // Tier 1: deny_patterns (only if policy exists)
    if (command && hasPolicy) {
      for (const pat of policy.denyPatterns) {
        if (new RegExp(pat).test(command)) {
          return [false, "auto_deny"];
        }
      }
    }

    // Tier 2: OUTSIDE_CWD_HEURISTICS
    const outsideCwd = Boolean(command && matchesOutsideCwd(command));

    if (!outsideCwd) {
      // Tier 3: session-level always cache
      const sessionKey = sessionCacheKey(sessionId, tool);
      const sessionCached = this._sessionAlways.get(sessionKey);
      if (sessionCached !== undefined) {
        return [sessionCached === "allow", `auto_${sessionCached}`];
      }

      // Tier 4: persistent always
      if (tool in this._persistentAlways) {
        const cached = this._persistentAlways[tool];
        return [cached === "allow", `auto_${cached}`];
      }

      // Tier 5: allow_patterns (only if policy exists)
      if (command && hasPolicy) {
        for (const pat of policy.allowPatterns) {
          if (new RegExp(pat).test(command)) {
            return [true, "auto_allow"];
          }
        }
      }

      // Tier 6: tool default (only if policy exists)
      if (hasPolicy) {
        if (policy.default === "allow") return [true, "auto_allow"];
        if (policy.default === "deny") return [false, "auto_deny"];
      }
    }

    // ASK path
    const { promise, resolve } = Promise.withResolvers<string>();
    // Store the normalized tool name so cache writes on respond use the same key
    this._pending.set(toolUseId, { resolve, sessionId, toolName: tool });

    await eventEmitter({
      type: "permission.requested",
      tool_use_id: toolUseId,
      tool_name: toolName,
      params,
      param_preview: paramPreview(toolName, params),
      session_id: sessionId,
      timestamp: new Date().toISOString(),
    });

    let raw: string;
    try {
      if (this._timeoutS > 0) {
        raw = await withTimeout(promise, this._timeoutS * 1000);
      } else {
        raw = await promise;
      }
    } catch (e) {
      this._pending.delete(toolUseId);
      if (e instanceof PermissionTimeoutError) {
        return [false, "timeout"];
      }
      throw e;
    }

    const allowed = this._applyResponse(raw, sessionId, tool);
    return [allowed, raw];
  }

  // Handle client approval decision and resolve the pending promise
  respond(toolUseId: string, decision: string): void {
    const req = this._pending.get(toolUseId);
    if (!req) {
      getLogger().warn(`permission.respond: unknown tool_use_id=${toolUseId}`);
      return;
    }
    this._pending.delete(toolUseId);
    req.resolve(decision);
  }

  // Apply approval decision and update caches
  private _applyResponse(decision: string, sessionId: string, toolName: string): boolean {
    const allow = decision === "allow_once" || decision === "always_allow";

    if (decision === "always_allow") {
      this._sessionAlways.set(sessionCacheKey(sessionId, toolName), "allow");
      this._persistentAlways[toolName] = "allow";
      this._savePersistent();
    } else if (decision === "always_deny") {
      this._sessionAlways.set(sessionCacheKey(sessionId, toolName), "deny");
      this._persistentAlways[toolName] = "deny";
      this._savePersistent();
    }
    return allow;
  }

  // Persist the always cache to the policy file; failure is logged but non-blocking
  private _savePersistent(): void {
    if (!this._policyFile) return;
    try {
      savePolicyFile(this._persistentAlways, this._policyFile);
    } catch (e) {
      getLogger().warn(
        `permission: failed to persist policy file ${this._policyFile}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Reject all pending requests for a session. Reserved for per-session
  // cancellation; the disconnect path currently uses cancelAll instead.
  cancelSession(sessionId: string, reason = "client_disconnected"): void {
    for (const [uid, req] of this._pending) {
      if (req.sessionId === sessionId) {
        getLogger().debug(`permission: cancel pending tool_use_id=${uid} reason=${reason}`);
        this._pending.delete(uid);
        req.resolve("deny_once");
      }
    }
  }

  // B-3: reject ALL pending requests regardless of session — used when the
  // last subscribed client disconnects and nobody is left to answer, so the
  // agent does not sit frozen until the permission timeout expires
  cancelAll(reason: string): void {
    for (const [uid, req] of this._pending) {
      getLogger().debug(`permission: cancel pending tool_use_id=${uid} reason=${reason}`);
      this._pending.delete(uid);
      req.resolve("deny_once");
    }
  }
}
