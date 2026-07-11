/* eslint-disable no-console */
import { CodeReviewManager } from "../src/code-review/manager.js";
import { TeamManager } from "../src/teams/team.js";
import { ReviewSession } from "../src/code-review/session.js";

function criticEvaluation() {
  const workDir = process.cwd();
  const teamManager = new TeamManager(workDir);
  const manager = new CodeReviewManager(workDir, teamManager);
  const session = new ReviewSession(workDir, manager);

  // Ensure we have a critic member
  try {
    manager.addMember("core-review-team", {
      name: "david",
      email: "david@company.com",
      role: "critic",
      expertise: ["code-review", "software-architecture", "security-audit", "best-practices"],
    });
  } catch (e) {
    // Critic might already exist
  }

  // Create a review request for agent.ts code review
  const request = session.createReviewRequest(
    "core-review-team",
    "Review src/agent/agent.ts code quality",
    "Comprehensive code review of Agent class implementation",
    "developer-sarah",
    "feature/agent-refactoring",
    ["src/agent/agent.ts"],
  );

  console.log(`Created Review Request: ${request.id}`);

  // Simulate reviewer suggestions (the ones we analyzed)
  const suggestion1 = session.addComment(
    request.id,
    "taylor",
    "Suggestion #1: Add stream exception handling. Current code lacks proper error handling for stream interruptions. Should wrap the for-await loop in try-catch to handle stream failures gracefully.",
    "src/agent/agent.ts",
    60,
  );

  const suggestion2 = session.addComment(
    request.id,
    "taylor",
    "Suggestion #2: Add timeout control for tool execution. Current executor.collectResults() has no timeout, which could cause indefinite hangs. Should implement Promise.race with timeout.",
    "src/agent/agent.ts",
    211,
  );

  const suggestion3 = session.addComment(
    request.id,
    "taylor",
    "Suggestion #3: Fix memory leak in activeSkills Map. The activeSkills Map is never cleaned up, causing potential memory leaks. Should clear it in finally block.",
    "src/agent/agent.ts",
    34,
  );

  const suggestion4 = session.addComment(
    request.id,
    "taylor",
    "Suggestion #4: Add input validation in constructor. Current constructor assigns values directly without validation. Should validate required parameters like client, registry, etc.",
    "src/agent/agent.ts",
    36,
  );

  const suggestion5 = session.addComment(
    request.id,
    "taylor",
    "Suggestion #5: Extract magic number to constant. The hardcoded value '60' for summary length should be extracted to a static readonly constant.",
    "src/agent/agent.ts",
    135,
  );

  console.log("\nTaylor (Reviewer) added 5 code improvement suggestions");

  // Now David (Critic) evaluates each suggestion
  console.log("\nDavid (Critic) is evaluating each suggestion...\n");

  // Evaluate suggestion 1
  session.addCriticEvaluation(
    request.id,
    suggestion1.id,
    "david",
    "reasonable",
    "Stream exception handling is critical for robustness. The for-await loop can fail due to network issues, LLM service interruptions, or malformed responses. However, the implementation should be more nuanced - we should distinguish between recoverable and non-recoverable stream errors, and implement proper retry logic for transient failures.",
  );

  console.log("Suggestion #1: REASONABLE");
  console.log("Reason: Stream error handling is essential, but needs retry logic");

  // Evaluate suggestion 2
  session.addCriticEvaluation(
    request.id,
    suggestion2.id,
    "david",
    "partially-reasonable",
    "Timeout control is important, but the proposed Promise.race implementation has issues: 1) It doesn't actually cancel the running operation when timeout occurs, 2) Fixed 30s timeout may not suit all tools, 3) Should be configurable per tool type. Better approach: implement proper cancellation tokens and tool-specific timeout policies.",
  );

  console.log("Suggestion #2: PARTIALLY REASONABLE");
  console.log("Reason: Timeout needed, but Promise.race approach is flawed");

  // Evaluate suggestion 3
  session.addCriticEvaluation(
    request.id,
    suggestion3.id,
    "david",
    "unreasonable",
    "This suggestion is based on incorrect analysis. The activeSkills Map is defined but never actually used in the current implementation - there are no methods that add entries to it. Calling clear() on an empty Map is pointless and adds unnecessary complexity. This appears to be leftover code from a previous implementation that should be removed entirely, not managed.",
  );

  console.log("Suggestion #3: UNREASONABLE");
  console.log("Reason: activeSkills Map is unused - should be removed, not managed");

  // Evaluate suggestion 4
  session.addCriticEvaluation(
    request.id,
    suggestion4.id,
    "david",
    "partially-reasonable",
    "Input validation is good practice, but the suggested implementation is too simplistic: 1) Throwing errors in constructor makes the class hard to test, 2) Validation logic should be more sophisticated (e.g., checking if client implements required methods), 3) Consider using validation schema or builder pattern instead. Better: implement validateConfig() static method that returns detailed validation results.",
  );

  console.log("Suggestion #4: PARTIALLY REASONABLE");
  console.log("Reason: Validation needed, but constructor validation is problematic");

  // Evaluate suggestion 5
  session.addCriticEvaluation(
    request.id,
    suggestion5.id,
    "david",
    "unreasonable",
    "This is premature optimization and code clutter. The value '60' is used only once for a UI display summary, not business logic. Extracting it to a constant adds overhead without meaningful benefit. Magic numbers should be extracted when: 1) Used multiple times, 2) Have business meaning, 3) Need to be configurable. This single-use display threshold doesn't meet any of these criteria.",
  );

  console.log("Suggestion #5: UNREASONABLE");
  console.log("Reason: Single-use display value doesn't warrant constant extraction");

  // Generate critic summary
  console.log("\n" + "=".repeat(60));
  console.log("CRITIC EVALUATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`Review Request: ${request.id}`);
  console.log(`File: src/agent/agent.ts`);
  console.log(`Total Suggestions: 5`);

  const evaluations = {
    reasonable: 1,
    partiallyReasonable: 2,
    unreasonable: 2,
  };

  console.log(`\nReasonable: ${String(evaluations.reasonable)}`);
  console.log(`Partially Reasonable: ${String(evaluations.partiallyReasonable)}`);
  console.log(`Unreasonable: ${String(evaluations.unreasonable)}`);
  console.log(`Reasonable Rate: ${((evaluations.reasonable / 5) * 100).toFixed(1)}%`);

  console.log("\nKEY INSIGHTS:");
  console.log("1. Stream error handling is critical (accept with enhancement)");
  console.log("2. Timeout control needed but requires proper implementation");
  console.log("3. Remove unused code instead of managing it");
  console.log("4. Validation should use more sophisticated patterns");
  console.log("5. Avoid premature optimization on single-use values");

  console.log("\nRECOMMENDED ACTIONS:");
  console.log("1. HIGH: Implement robust stream error handling with retry");
  console.log("2. MEDIUM: Design proper timeout/cancellation system");
  console.log("3. HIGH: Remove unused activeSkills Map");
  console.log("4. LOW: Consider validation framework for config");
  console.log("5. SKIP: Keep inline value for display summary");

  console.log("\nCRITIC CONCLUSION:");
  console.log("The reviewer shows good attention to detail but needs better");
  console.log("understanding of: actual code usage patterns, proper error");
  console.log("handling strategies, and when optimization is appropriate.");
  console.log("2/5 suggestions are fundamentally sound, 2 need refinement,");
  console.log("1 should be rejected entirely.");

  console.log("\nCritic evaluation complete!");
}

try {
  criticEvaluation();
} catch (err) {
  console.error(err);
}
