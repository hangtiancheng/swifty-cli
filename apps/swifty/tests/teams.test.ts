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

/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamManager } from "../src/teams/team.js";
import {
  TeamCreateTool,
  SpawnTeammateTool,
  SendMessageTool,
  ListTeamsTool,
} from "../src/teams/tools.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const workDir = () => mkdtempSync(join(tmpdir(), "swifty-team-"));

describe("teams orchestration", () => {
  it("spawnTeammate runs the task and posts its result to the lead mailbox", async () => {
    const mgr = new TeamManager(workDir());
    const team = mgr.create("squad");
    team.spawnTeammate("scout", "find X", async (task) => `did: ${task}`);

    await wait(200);
    const drained = mgr.drainLeads();
    // The teammate sends an [idle] notification with its name after finishing
    expect(drained.some((d) => d.includes("scout") && d.includes("[idle]"))).toBe(true);
    // Drained messages are consumed.
    expect(mgr.drainLeads()).toEqual([]);
  });

  it("a failing teammate reports the error to the lead", async () => {
    const mgr = new TeamManager(workDir());
    mgr.create("squad").spawnTeammate("flaky", "boom", async () => {
      throw new Error("kaboom");
    });
    await wait(200);
    expect(mgr.drainLeads().some((d) => d.includes("failed"))).toBe(true);
  });

  it("coordination tools create, spawn, message, and list", async () => {
    const mgr = new TeamManager(workDir());

    expect(
      (
        await new TeamCreateTool(mgr).execute(
          {
            workDir: workDir(),
          },
          { name: "t1" },
        )
      ).output,
    ).toContain("created");

    const spawn = new SpawnTeammateTool(mgr, async (task) => `done:${task}`);
    const r = await spawn.execute(
      {
        workDir: workDir(),
      },
      { team: "t1", name: "w1", task: "task A" },
    );
    expect(r.isError).toBe(false);
    await wait(200);
    expect(mgr.drainLeads().some((d) => d.includes("w1") && d.includes("[idle]"))).toBe(true);

    // SendMessage to an existing member lands in that member's mailbox.
    const send = await new SendMessageTool(mgr).execute(
      {
        workDir: workDir(),
      },
      {
        team: "t1",
        to: "w1",
        message: "hi",
      },
    );
    expect(send.isError).toBe(false);
    expect(
      mgr
        .get("t1")
        ?.getMember("w1")
        ?.mailbox.receiveSync()
        .map((m) => m.text),
    ).toContain("hi");

    const list = await new ListTeamsTool(mgr).execute();
    expect(list.output).toContain("t1");
    expect(list.output).toContain("w1");
  });

  it("validates required args", async () => {
    const mgr = new TeamManager(workDir());
    expect(
      (
        await new TeamCreateTool(mgr).execute(
          {
            workDir: workDir(),
          },
          {},
        )
      ).isError,
    ).toBe(true);
    expect(
      (
        await new SpawnTeammateTool(mgr, async () => "x").execute(
          {
            workDir: workDir(),
          },
          { team: "t" },
        )
      ).isError,
    ).toBe(true);
    expect(
      (
        await new SendMessageTool(mgr).execute(
          {
            workDir: workDir(),
          },
          {
            team: "nope",
            to: "a",
            message: "m",
          },
        )
      ).isError,
    ).toBe(true);
  });
});
