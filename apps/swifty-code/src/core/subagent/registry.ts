// Background task registry: track async subagent tasks with their execution context
import type { ExecutionContext } from "../context.js";

type TaskStatus = "pending" | "fulfilled" | "rejected" | "cancelled";

interface TaskEntry {
  promise: Promise<void>;
  context: ExecutionContext;
  status: TaskStatus;
  error: string | null;
}

export class BackgroundTaskRegistry {
  private _tasks = new Map<string, TaskEntry>();

  register(taskId: string, promise: Promise<void>, context: ExecutionContext): void {
    const entry: TaskEntry = {
      promise,
      context,
      status: "pending",
      error: null,
    };
    // Track promise settlement to enable synchronous status checks in AgentResultTool.
    // The void operator satisfies no-floating-promises; the then callback updates
    // status only if still pending (cancelled tasks keep their cancelled status).
    void promise.then(
      () => {
        if (entry.status === "pending") {
          entry.status = "fulfilled";
        }
      },
      (err: unknown) => {
        if (entry.status === "pending") {
          entry.status = "rejected";
          entry.error = err instanceof Error ? err.message : String(err);
        }
      },
    );
    this._tasks.set(taskId, entry);
  }

  get(taskId: string): TaskEntry | undefined {
    return this._tasks.get(taskId);
  }

  all(): [string, TaskEntry][] {
    return [...this._tasks.entries()];
  }

  // Mark a pending task as cancelled. The underlying promise is not actually
  // cancelled (JS has no native promise cancellation), but the status allows
  // AgentResultTool to report the cancelled state.
  cancel(taskId: string): void {
    const entry = this._tasks.get(taskId);
    if (entry?.status === "pending") {
      entry.status = "cancelled";
    }
  }

  remove(taskId: string): void {
    this._tasks.delete(taskId);
  }
}
