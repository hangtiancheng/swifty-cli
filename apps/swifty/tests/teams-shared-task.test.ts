import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NameRegistry, getNameRegistry } from "../src/teams/registry.js";
import { SharedTaskStore } from "../src/teams/shared-task.js";
import { TeamManager } from "../src/teams/team.js";
import {
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskUpdateTool,
} from "../src/teams/task-tools.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "swifty-teams-"));
}

describe("NameRegistry", () => {
  test("resolves by name and by id, unknown returns undefined", () => {
    const reg = new NameRegistry();
    reg.register("reviewer", "agent-7");
    expect(reg.resolve("reviewer")).toBe("agent-7");
    expect(reg.resolve("agent-7")).toBe("agent-7");
    expect(reg.resolve("ghost")).toBeUndefined();
  });

  test("unregister removes mapping", () => {
    const reg = new NameRegistry();
    reg.register("reviewer", "agent-7");
    reg.unregister("reviewer");
    expect(reg.resolve("reviewer")).toBeUndefined();
  });
});

describe("SharedTaskStore", () => {
  test("create assigns string ids and pending status", () => {
    const store = new SharedTaskStore(join(tempDir(), "tasks.json"));
    const t1 = store.create("first", "", "", [], [], "lead");
    const t2 = store.create("second", "desc", "alice", [], [], "lead");
    expect(t1.id).toBe("1");
    expect(t2.id).toBe("2");
    expect(t1.status).toBe("pending");
    expect(t2.assignee).toBe("alice");
  });

  test("get and list with filters", () => {
    const store = new SharedTaskStore(join(tempDir(), "tasks.json"));
    store.create("a", "", "alice", [], [], "");
    const b = store.create("b", "", "bob", [], [], "");
    store.update(b.id, { status: "completed" });
    expect(store.get("999")).toBeUndefined();
    expect(store.listTasks().length).toBe(2);
    expect(store.listTasks("completed").length).toBe(1);
    expect(store.listTasks(undefined, "alice").length).toBe(1);
    expect(store.listTasks("completed", "alice").length).toBe(0);
  });

  test("update changes fields and dedups dependencies", () => {
    const store = new SharedTaskStore(join(tempDir(), "tasks.json"));
    const t = store.create("task", "", "", [], [], "");
    const updated = store.update(t.id, {
      status: "in_progress",
      assignee: "carol",
      addBlocks: ["2"],
    });
    expect(updated?.status).toBe("in_progress");
    expect(updated?.blocks).toEqual(["2"]);
    const again = store.update(t.id, { addBlocks: ["2"] });
    expect(again?.blocks).toEqual(["2"]);
    expect(store.update("nope", { status: "completed" })).toBeUndefined();
  });

  test("persists across instances and reloads latest", () => {
    const path = join(tempDir(), "tasks.json");
    const s1 = new SharedTaskStore(path);
    s1.create("persisted", "", "", [], [], "lead");
    const s2 = new SharedTaskStore(path);
    expect(s2.listTasks().length).toBe(1);
    s2.create("from-teammate", "", "", [], [], "bob");
    expect(s1.get("2")?.title).toBe("from-teammate");
  });

  test("initEmpty clears and resets ids", () => {
    const store = new SharedTaskStore(join(tempDir(), "tasks.json"));
    store.create("x", "", "", [], [], "");
    store.initEmpty();
    expect(store.listTasks().length).toBe(0);
    expect(store.create("y", "", "", [], [], "").id).toBe("1");
  });
});

describe("team task tools", () => {
  let mgr: TeamManager;

  beforeEach(() => {
    getNameRegistry().clear();
    mgr = new TeamManager(tempDir());
    mgr.create("my-team");
  });

  test("create team initializes an empty shared store", () => {
    expect(mgr.getTaskStore("my-team").listTasks().length).toBe(0);
  });

  test("create → list → update → get flow shares one board", async () => {
    const create = new TaskCreateTool(mgr, "my-team", "lead");
    const list = new TaskListTool(mgr, "my-team");
    const update = new TaskUpdateTool(mgr, "my-team");
    const get = new TaskGetTool(mgr, "my-team");
    const ctx = { workDir: "." };

    const created = await create.execute(ctx, {
      title: "build parser",
      assignee: "alice",
    });
    expect(created.isError).toBe(false);
    expect(created.output).toContain("ID: 1");

    const listed = await list.execute(ctx, {});
    expect(listed.output).toContain("[1] build parser");
    expect(listed.output).toContain("[alice]");

    const updated = await update.execute(ctx, {
      task_id: "1",
      status: "completed",
    });
    expect(updated.output).toContain("status → completed");

    const got = await get.execute(ctx, { task_id: "1" });
    expect(got.output).toContain("Status:     completed");

    const pending = await list.execute(ctx, { status: "pending" });
    expect(pending.output).toContain("No tasks found");
  });

  test("update rejects invalid status", async () => {
    const ctx = { workDir: "." };
    await new TaskCreateTool(mgr, "my-team").execute(ctx, { title: "t" });
    const r = await new TaskUpdateTool(mgr, "my-team").execute(ctx, {
      task_id: "1",
      status: "done",
    });
    expect(r.isError).toBe(true);
    expect(r.output).toContain("Invalid status");
  });

  test("delete team unregisters members", async () => {
    const team = mgr.get("my-team");
    team?.addMember("alice");
    getNameRegistry().register("alice", "alice");
    await mgr.delete("my-team");
    expect(mgr.get("my-team")).toBeUndefined();
    expect(getNameRegistry().resolve("alice")).toBeUndefined();
  });
});
