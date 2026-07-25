import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TeamManager } from "../src/teams/team.js";
import { readTeamFile, teamDir, teamsBaseDir } from "../src/teams/team-file.js";

// The teams directory lives at <home>/.swifty/teams, so redirect the entire
// home directory to a temp dir to avoid leaving residue in the real
// ~/.swifty/teams. os.homedir() reads USERPROFILE on Windows and HOME on other
// platforms, so set both.
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  origUserProfile = process.env.USERPROFILE;
  const tmp = mkdtempSync(join(tmpdir(), "swifty-home-"));
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
});

afterEach(() => {
  if (origHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = origHome;
  }
  if (origUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = origUserProfile;
  }
});

const workDir = () => mkdtempSync(join(tmpdir(), "swifty-work-"));

describe("team config persistence", () => {
  test("can be read back by a fresh TeamManager after writing to disk", () => {
    const mgr = new TeamManager(workDir());
    const team = mgr.create("Refactor Auth", "in-process", {
      leadAgentId: "lead",
      description: "Refactor the authentication module",
    });
    team.addMember("alice");
    team.setMemberMeta("alice", {
      agentType: "worker",
      model: "claude-sonnet-4-6",
      worktreePath: "/tmp/wt/alice",
    });

    // Swap in a brand-new manager to simulate a teammate process or the next session
    const fresh = new TeamManager(workDir());
    const got = fresh.get("Refactor Auth");

    expect(got).toBeDefined();
    expect(got?.leadAgentId).toBe("lead");
    expect(got?.description).toBe("Refactor the authentication module");

    const m = got?.getMember("alice");
    expect(m).toBeDefined();
    expect(m?.agentType).toBe("worker");
    expect(m?.model).toBe("claude-sonnet-4-6");
    expect(m?.worktreePath).toBe("/tmp/wt/alice");
  });

  test("slugifies the team directory name", () => {
    const mgr = new TeamManager(workDir());
    mgr.create("Refactor Auth!", "tmux", { leadAgentId: "lead" });

    const expected = join(teamsBaseDir(), "refactor-auth-", "config.json");
    expect(existsSync(expected)).toBe(true);
  });

  test("tearing down a team removes the entire team directory", async () => {
    const mgr = new TeamManager(workDir());
    mgr.create("gone", "in-process", { leadAgentId: "lead" });
    expect(existsSync(teamDir("gone"))).toBe(true);

    await mgr.delete("gone");
    expect(existsSync(teamDir("gone"))).toBe(false);
    expect(new TeamManager(workDir()).get("gone")).toBeUndefined();
  });

  test("returns undefined for a team that does not exist", () => {
    expect(new TeamManager(workDir()).get("never-existed")).toBeUndefined();
  });

  test("persists a member's active state into the config", async () => {
    const mgr = new TeamManager(workDir());
    const team = mgr.create("t", "in-process", { leadAgentId: "lead" });
    team.addMember("bob");
    await team.stopMember("bob");

    const tf = readTeamFile("t");
    expect(tf).not.toBeNull();
    expect(tf?.members).toHaveLength(1);
    expect(tf?.members[0].isActive).toBe(false);
  });
});
