import { createChildLogger } from "../logger/index.js";

const log = createChildLogger({ module: "todo" });

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import z, { parse } from "zod";

const TaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

const TaskSchema = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  owner: z.string().optional(),
  activeForm: z.string().optional(),
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
});

export type Task = z.infer<typeof TaskSchema>;

export class TaskStore {
  private filePath: string;

  // Session-scoped store: .swifty/tasks/<listId>.json (mirrors Go NewStore).
  constructor(workDir: string, listId: string) {
    this.filePath = join(workDir, ".swifty", "tasks", `${listId}.json`);
  }

  load(): Task[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const data = readFileSync(this.filePath, "utf-8");
      const raw: unknown = JSON.parse(data);
      const parsed = parse(z.array(TaskSchema), raw);
      return parsed;
    } catch (err) {
      log.error({ err }, "todo operation failed");
      return [];
    }
  }

  save(tasks: Task[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(tasks, null, 2), "utf-8");
  }
}
