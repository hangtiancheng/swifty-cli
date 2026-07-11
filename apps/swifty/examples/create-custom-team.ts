/* eslint-disable no-console */
import { CodeReviewManager } from "../src/code-review/manager.js";
import { TeamManager } from "../src/teams/team.js";
import { ReviewSession } from "../src/code-review/session.js";
function createCustomThreePersonTeam() {
  const workDir = process.cwd();
  const teamManager = new TeamManager(workDir);
  const manager = new CodeReviewManager(workDir, teamManager);
  const session = new ReviewSession(workDir, manager);

  // Create a custom 3-person code review team
  const team = manager.createTeam("core-review-team", [
    {
      name: "react",
      email: "react@company.com",
      role: "lead",
      expertise: ["system-design", "security", "performance-optimization"],
    },
    {
      name: "vue",
      email: "vue@company.com",
      role: "reviewer",
      expertise: ["unit-testing", "integration-testing", "code-quality"],
    },
    {
      name: "angular",
      email: "angular@company.com",
      role: "reviewer",
      expertise: ["typescript", "api-design", "error-handling"],
    },
  ]);

  console.log("Created custom 3-person code review team:");
  console.log(`Team Name: ${team.name}`);
  console.log(`Created: ${new Date(team.createdAt).toLocaleString()}`);
  console.log("\nTeam Members:");

  team.members.forEach((member, index) => {
    const status = member.active ? "Active" : "Inactive";
    const roleIcon = member.role === "lead" ? "L" : "M";
    console.log(`${String(index + 1)}. ${roleIcon} ${member.name} (${member.role})`);
    console.log(`Email: ${member.email}`);
    console.log(`Expertise: ${member.expertise.join(", ")}`);
    console.log(`Status: ${status}`);
  });

  // Show team status
  console.log("\nTeam Status:");
  console.log(manager.getTeamSummary("core-review-team"));

  // Create a review request for core functionality
  const request = session.createReviewRequest(
    "core-review-team",
    "Implement core user management system",
    "Add user registration, login, and profile management functionality",
    "developer-sarah",
    "feature/user-management",
    ["src/auth/user-manager.ts", "src/api/user-routes.ts"],
  );

  console.log("\nCore Review Request Created:");
  console.log(`Request ID: ${request.id}`);
  console.log(`Title: ${request.title}`);
  console.log(`Author: ${request.author}`);
  console.log(`Branch: ${request.branch}`);
  console.log(`Reviewers: ${request.reviewers.join(", ")}`);
  console.log(`Status: ${request.status}`);

  // Add review comments from each team member
  const reactComment = session.addComment(
    request.id,
    "react",
    "Consider implementing rate limiting for login attempts to prevent brute force attacks",
    "src/auth/user-manager.ts",
    120,
  );

  const vueComment = session.addComment(
    request.id,
    "vue",
    "Add comprehensive unit tests for password validation logic",
    "src/auth/user-manager.ts",
    85,
  );

  const angularComment = session.addComment(
    request.id,
    "angular",
    "Use TypeScript strict mode and ensure proper error types are defined",
    "src/api/user-routes.ts",
    45,
  );

  console.log("\nReview Comments Added:");
  console.log(`react (Lead): Security-focused comment`);
  console.log(`vue (Reviewer): Testing-focused comment`);
  console.log(`angular (Reviewer): TypeScript-focused comment`);

  // Process some comments
  session.acceptComment(request.id, reactComment.id, "Implementing rate limiting with Redis");
  session.acceptComment(request.id, vueComment.id, "Adding comprehensive test suite");
  session.rejectComment(request.id, angularComment.id, "TypeScript strict mode already enabled");

  // Generate final report
  const summary = session.generateFinalReport(request.id);
  console.log("\nReview Summary:");
  console.log(`Total Comments: ${String(summary.totalComments)}`);
  console.log(`Accepted: ${String(summary.acceptedSuggestions)}`);
  console.log(`Rejected: ${String(summary.rejectedSuggestions)}`);
  console.log(`Overall Conclusion: ${summary.overallConclusion.toUpperCase()}`);

  console.log("\nTeam Configuration:");
  console.log(`Configuration saved to: .swifty/code-review-teams.json`);
  console.log(`Team can be managed via: /code-review commands`);

  console.log("\nCustom 3-person code review team creation complete!");
  console.log("\nNext Steps:");
  console.log("1. Use /code-review status core-review-team to check team status");
  console.log("2. Use /code-review request core-review-team to create new review requests");
  console.log("3. Use /code-comment to add review comments");
  console.log("4. Use /code-review report to generate final reports");
}

try {
  createCustomThreePersonTeam();
} catch (err) {
  console.error(err);
}
