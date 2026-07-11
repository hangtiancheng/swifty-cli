/* eslint-disable no-console */
import { CodeReviewManager } from "../src/code-review/manager.js";
import { TeamManager } from "../src/teams/team.js";
import { ReviewSession } from "../src/code-review/session.js";

function createThreePersonTeam() {
  const workDir = process.cwd();
  const teamManager = new TeamManager(workDir);
  const manager = new CodeReviewManager(workDir, teamManager);
  const session = new ReviewSession(workDir, manager);

  // Create a 3-person code review team
  const team = manager.createTeam("security-review-team", [
    {
      name: "react",
      email: "react@company.com",
      role: "lead",
      expertise: ["security", "architecture", "performance"],
    },
    {
      name: "vue",
      email: "vue@company.com",
      role: "reviewer",
      expertise: ["testing", "code-quality", "documentation"],
    },
    {
      name: "angular",
      email: "angular@company.com",
      role: "reviewer",
      expertise: ["typescript", "backend", "api-security"],
    },
  ]);

  console.log("Created 3-person code review team:");
  console.log(`Team Name: ${team.name}`);
  console.log(`Created: ${new Date(team.createdAt).toLocaleString()}`);
  console.log("\nTeam Members:");

  team.members.forEach((member, index) => {
    const status = member.active ? "✅ Active" : "❌ Inactive";
    console.log(`${String(index + 1)}. ${member.name} (${member.role})`);
    console.log(`Email: ${member.email}`);
    console.log(`Expertise: ${member.expertise.join(", ")}`);
    console.log(`Status: ${status}`);
  });

  // Show team status
  console.log("\nTeam Status:");
  console.log(manager.getTeamSummary("security-review-team"));

  // Create a sample review request
  const request = session.createReviewRequest(
    "security-review-team",
    "Fix authentication vulnerability",
    "Implement secure password hashing and session management",
    "developer-john",
    "feature/security-fix",
    ["src/auth/password.ts", "src/auth/session.ts"],
  );

  console.log("\nSample Review Request Created:");
  console.log(`Request ID: ${request.id}`);
  console.log(`Title: ${request.title}`);
  console.log(`Author: ${request.author}`);
  console.log(`Branch: ${request.branch}`);
  console.log(`Reviewers: ${request.reviewers.join(", ")}`);
  console.log(`Status: ${request.status}`);

  // Add some sample comments
  const comment1 = session.addComment(
    request.id,
    "react",
    "Use bcrypt with cost factor 12 for password hashing",
    "src/auth/password.ts",
    45,
  );

  const comment2 = session.addComment(
    request.id,
    "vue",
    "Add unit tests for session timeout logic",
    "src/auth/session.ts",
    78,
  );

  const comment3 = session.addComment(
    request.id,
    "angular",
    "Consider implementing CSRF protection for session cookies",
    "src/auth/session.ts",
    23,
  );

  console.log("\nSample Comments Added:");
  console.log(`Total Comments: ${String(request.comments.length)}`);

  // List all teams
  console.log("\nAll Available Teams:");
  const allTeams = manager.listTeams();
  allTeams.forEach((t) => {
    const activeMembers = t.members.filter((m) => m.active).length;
    console.log(
      `• ${t.name} (${String(activeMembers)}/${String(t.members.length)} active members)`,
    );
  });

  // Generate final report
  session.acceptComment(request.id, comment1.id, "Will implement bcrypt with cost factor 12");
  session.acceptComment(request.id, comment2.id, "Adding comprehensive unit tests now");
  session.rejectComment(
    request.id,
    comment3.id,
    "CSRF protection already implemented in middleware",
  );

  const summary = session.generateFinalReport(request.id);
  console.log("\nReview Summary:");
  console.log(`Total Comments: ${String(summary.totalComments)}`);
  console.log(`Accepted: ${String(summary.acceptedSuggestions)}`);
  console.log(`Rejected: ${String(summary.rejectedSuggestions)}`);
  console.log(`Overall Conclusion: ${summary.overallConclusion.toUpperCase()}`);

  console.log("\n3-person code review team setup complete!");
}

try {
  createThreePersonTeam();
} catch (err) {
  console.error(err);
}
