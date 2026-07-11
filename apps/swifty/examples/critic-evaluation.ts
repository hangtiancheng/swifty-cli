/* eslint-disable no-console */
import { CodeReviewManager } from "../src/code-review/manager.js";
import { TeamManager } from "../src/teams/team.js";
import { ReviewSession } from "../src/code-review/session.js";

function criticEvaluation() {
  const workDir = process.cwd();
  const teamManager = new TeamManager(workDir);
  const manager = new CodeReviewManager(workDir, teamManager);
  const session = new ReviewSession(workDir, manager);

  // First, ensure we have the security-review-team with a critic
  console.log("Setting up security-review-team with critic member...");

  try {
    manager.addMember("security-review-team", {
      name: "david",
      email: "david@company.com",
      role: "critic",
      expertise: ["code-review", "quality-assurance", "architecture-review", "security-audit"],
    });
    console.log("Added david as critic");
  } catch (err) {
    console.error(err);
    console.log("David already exists as critic member");
  }

  // Create a new review request
  const request = session.createReviewRequest(
    "security-review-team",
    "Review src/agent/agent.ts code quality",
    "Please review the Agent class implementation for code quality, security, and best practices",
    "developer-team",
    "main",
    ["src/agent/agent.ts"],
  );

  console.log(`\nCreated Review Request: ${request.id}`);
  console.log(`  Title: ${request.title}`);
  console.log(`  Reviewers: ${request.reviewers.join(", ")}`);

  // Bob (Reviewer 1) adds comments
  console.log("\nBob (Reviewer) adding code quality comments:");

  const bobComments = [];

  bobComments.push(
    session.addComment(
      request.id,
      "bob",
      "Code quality assessment: The overall structure is clear, but edge case testing for error handling is missing. Recommend adding unit tests for the executeTools method, especially for scenarios involving permission check failures, hook rejections, and tool execution timeouts.",
      "src/agent/agent.ts",
      135,
    ),
  );

  bobComments.push(
    session.addComment(
      request.id,
      "bob",
      "Improvement suggestion 1: Add more detailed error handling logs in the run() method. The current catch block simply yields the error without context. Recommend logging error context information (current tool, arguments, state) for debugging purposes.",
      "src/agent/agent.ts",
      102,
    ),
  );

  bobComments.push(
    session.addComment(
      request.id,
      "bob",
      "Improvement suggestion 2: Add JSDoc comments to the AgentConfig interface, documenting the purpose and default values of each configuration property. In particular, the return value semantics of the onPermissionRequest callback require documentation.",
      "src/agent/agent.ts",
      9,
    ),
  );

  bobComments.push(
    session.addComment(
      request.id,
      "bob",
      "Improvement suggestion 3: Consider adding a configuration validation mechanism to verify required properties (client, registry, conversation) in the constructor, preventing undefined errors at runtime.",
      "src/agent/agent.ts",
      33,
    ),
  );

  // Charlie (Reviewer 2) adds comments
  console.log("Charlie (Reviewer) adding technical comments:");

  const charlieComments = [];

  charlieComments.push(
    session.addComment(
      request.id,
      "charlie",
      "Code quality assessment: TypeScript types are used well, but there are potential type safety concerns. toolSchemas is fetched outside the loop; if the tool registry changes dynamically at runtime, it could lead to schema inconsistencies.",
      "src/agent/agent.ts",
      44,
    ),
  );

  charlieComments.push(
    session.addComment(
      request.id,
      "charlie",
      "Improvement suggestion 1: Move the toolSchemas retrieval closer to tool execution, or add a cache invalidation mechanism. Consider dynamically fetching the latest schema at execution time to ensure synchronization with actually available tools.",
      "src/agent/agent.ts",
      44,
    ),
  );

  charlieComments.push(
    session.addComment(
      request.id,
      "charlie",
      "Improvement suggestion 2: Add tool execution timeout control in the executeTools method. There is currently no timeout mechanism; a malicious or stuck tool could block the entire Agent loop. Recommend setting reasonable timeout durations for each tool execution.",
      "src/agent/agent.ts",
      135,
    ),
  );

  charlieComments.push(
    session.addComment(
      request.id,
      "charlie",
      "Improvement suggestion 3: Enhance security by adding input validation and sanitization for toolName and arguments. Although PermissionChecker handles most security concerns, recommend adding additional parameter type validation before tool execution to prevent type confusion attacks.",
      "src/agent/agent.ts",
      160,
    ),
  );

  charlieComments.push(
    session.addComment(
      request.id,
      "charlie",
      "Security suggestion: After permission checks pass and before tool execution, recommend adding operation audit logging. Recording who executed which tool and when is important for security auditing and issue tracking.",
      "src/agent/agent.ts",
      177,
    ),
  );

  const totalComments = bobComments.length + charlieComments.length;
  console.log(`\nTotal Comments Added: ${String(totalComments)}`);

  // David (Critic) evaluates each comment
  console.log("\nDavid (Critic) evaluating reviewer suggestions...");
  console.log("=".repeat(50));

  // Evaluate Bob's comments
  console.log("\nBob's Comments Evaluation:");
  console.log("-".repeat(35));

  const evaluations = [];

  // Comment 1: Unit testing suggestion
  console.log("\n1. [Bob] Unit Testing Suggestion");
  console.log("  Suggestion: Overall structure is clear, but edge case testing...");
  const eval1 = session.addCriticAssessment(
    request.id,
    bobComments[0].id,
    "david",
    "reasonable",
    "Reasonable: Unit testing is critical for code quality. The executeTools method involves multiple complex flows including permission checks, hook triggers, and tool execution, all of which require comprehensive unit test coverage. The author's response about using a separate test file is insufficient; core logic tests should reside in the corresponding module's test file.",
  );
  evaluations.push(eval1);
  console.log(`  Assessment: ${eval1.evaluation.toUpperCase()}`);
  console.log(
    `  Rationale: Unit testing is a fundamental quality assurance practice; complex logic must have test coverage`,
  );

  // Comment 2: Error handling logs
  console.log("\n2. [Bob] Error Handling Log Suggestion");
  console.log("  Suggestion: Add more detailed error handling logs in run()...");
  const eval2 = session.addCriticAssessment(
    request.id,
    bobComments[1].id,
    "david",
    "reasonable",
    "Reasonable: Error handling logs are critical for production debugging. The current simple error yield does not provide sufficient context, especially in distributed or asynchronous environments. Detailed error context (tool name, arguments, execution state) is valuable for both diagnostics and system monitoring.",
  );
  evaluations.push(eval2);
  console.log(`  Assessment: ${eval2.evaluation.toUpperCase()}`);
  console.log(
    `  Rationale: Detailed error logs are essential for troubleshooting in production environments`,
  );

  // Comment 3: JSDoc documentation
  console.log("\n3. [Bob] JSDoc Documentation Suggestion");
  console.log("  Suggestion: Add JSDoc comments to the AgentConfig interface...");
  const eval3 = session.addCriticAssessment(
    request.id,
    bobComments[2].id,
    "david",
    "reasonable",
    "Reasonable: Code documentation is a key factor in maintainability. AgentConfig, as the core configuration interface, lacking clear documentation leads to usage difficulties and maintenance issues. The onPermissionRequest callback in particular has return value semantics that can lead to drastically different behaviors and must be clearly documented.",
  );
  evaluations.push(eval3);
  console.log(`  Assessment: ${eval3.evaluation.toUpperCase()}`);
  console.log(
    `  Rationale: Core configuration interfaces must have clear documentation; callback mechanisms especially require explicit documentation`,
  );

  // Comment 4: Configuration validation
  console.log("\n4. [Bob] Configuration Validation Suggestion");
  console.log("  Suggestion: Consider adding a configuration validation mechanism...");
  const eval4 = session.addCriticAssessment(
    request.id,
    bobComments[3].id,
    "david",
    "partially-reasonable",
    "Partially reasonable: TypeScript compile-time validation does provide basic guarantees, but runtime validation still has value. Especially in plugin systems or dynamic configuration scenarios, compile-time type checking cannot cover all cases. Recommend partial acceptance: add defensive checks on critical paths, but avoid excessive validation that impacts performance.",
  );
  evaluations.push(eval4);
  console.log(`  Assessment: ${eval4.evaluation.toUpperCase()}`);
  console.log(
    `  Rationale: Compile-time validation cannot fully replace runtime checks, but performance trade-offs must be considered`,
  );

  // Evaluate Charlie's comments
  console.log("\nCharlie's Comments Evaluation:");
  console.log("-".repeat(35));

  // Comment 5: Type safety with toolSchemas
  console.log("\n5. [Charlie] Schema Type Safety Suggestion");
  console.log("  Suggestion: TypeScript types are used well, but potential type safety...");
  const eval5 = session.addCriticAssessment(
    request.id,
    charlieComments[0].id,
    "david",
    "unreasonable",
    "Unreasonable: This concern is excessive. toolSchemas is fetched at the start of each run() invocation, and the Agent lifecycle is typically a single session. Under normal usage, the tool registry does not change dynamically during an Agent run. If such a requirement does exist, it should be addressed at the architectural level rather than adding complexity at this layer.",
  );
  evaluations.push(eval5);
  console.log(`  Assessment: ${eval5.evaluation.toUpperCase()}`);
  console.log(
    `  Rationale: Excessive concern; the tool registry does not change dynamically within the Agent lifecycle`,
  );

  // Comment 6: Dynamic schema retrieval
  console.log("\n6. [Charlie] Dynamic Schema Retrieval Suggestion");
  console.log("  Suggestion: Move toolSchemas retrieval closer to tool execution...");
  const eval6 = session.addCriticAssessment(
    request.id,
    charlieComments[1].id,
    "david",
    "unreasonable",
    "Unreasonable: This contradicts the previous suggestion. If the tool registry does not change dynamically, then dynamic schema retrieval is unnecessary and only adds performance overhead. This kind of 'security for security's sake' suggestion increases system complexity without tangible benefit. Simple design principles should be maintained.",
  );
  evaluations.push(eval6);
  console.log(`  Assessment: ${eval6.evaluation.toUpperCase()}`);
  console.log(
    `  Rationale: Contradicts the previous suggestion; adds complexity without tangible benefit`,
  );

  // Comment 7: Tool execution timeout
  console.log("\n7. [Charlie] Tool Execution Timeout Suggestion");
  console.log("  Suggestion: Add tool execution timeout control in executeTools...");
  const eval7 = session.addCriticAssessment(
    request.id,
    charlieComments[2].id,
    "david",
    "reasonable",
    "Reasonable: Timeout control is a critical guarantee for system stability. Tool execution without a timeout mechanism can indeed block the entire Agent loop, especially during network operations or external API calls. Recommend implementing a progressive timeout strategy: shorter timeout on first call, gradually increasing on retries, and consider a circuit breaker mechanism.",
  );
  evaluations.push(eval7);
  console.log(`  Assessment: ${eval7.evaluation.toUpperCase()}`);
  console.log(
    `  Rationale: Timeout control is fundamental to system stability, preventing tools from blocking the entire loop`,
  );

  // Comment 8: Input validation and sanitization
  console.log("\n8. [Charlie] Input Validation Suggestion");
  console.log("  Suggestion: Enhance security with input validation for toolName and arguments...");
  const eval8 = session.addCriticAssessment(
    request.id,
    charlieComments[3].id,
    "david",
    "partially-reasonable",
    "Partially reasonable: Although PermissionChecker does provide parameter validation, defense in depth is a security best practice. Recommend adding lightweight type and format validation at the tool execution layer as a safety net mechanism. However, avoid excessive validation that leads to performance issues and maintenance burden.",
  );
  evaluations.push(eval8);
  console.log(`  Assessment: ${eval8.evaluation.toUpperCase()}`);
  console.log(
    `  Rationale: Defense in depth is a security best practice, but performance and maintenance costs must be balanced`,
  );

  // Comment 9: Security audit logging
  console.log("\n9. [Charlie] Security Audit Logging Suggestion");
  console.log(
    "  Suggestion: After permission checks pass, before tool execution, add audit logging...",
  );
  const eval9 = session.addCriticAssessment(
    request.id,
    charlieComments[4].id,
    "david",
    "reasonable",
    "Reasonable: Security audit logging is a non-negotiable security requirement. In AI Agent systems capable of executing real operations, recording detailed information for each tool execution (operator, timestamp, arguments, results) is fundamental for compliance and security traceability. This is not only a security best practice but a legal requirement in many scenarios.",
  );
  evaluations.push(eval9);
  console.log(`  Assessment: ${eval9.evaluation.toUpperCase()}`);
  console.log(
    `  Rationale: AI Agent systems must have complete security audit capabilities; this is a compliance requirement`,
  );

  // Generate comprehensive critic summary
  console.log("\nCOMPREHENSIVE CRITIC EVALUATION SUMMARY");
  console.log("=".repeat(42));

  const criticSummary = session.getCriticSummary(request.id);
  console.log(criticSummary);

  // Analysis statistics
  const reasonableCount = evaluations.filter((e) => e.evaluation === "reasonable").length;
  const unreasonableCount = evaluations.filter((e) => e.evaluation === "unreasonable").length;
  const partiallyReasonableCount = evaluations.filter(
    (e) => e.evaluation === "partially-reasonable",
  ).length;

  const reasonableRate = (
    ((reasonableCount + partiallyReasonableCount * 0.5) / evaluations.length) *
    100
  ).toFixed(1);

  console.log(`\nEVALUATION STATISTICS
${"-".repeat(35)}
Reasonable:           ${String(reasonableCount)}
Unreasonable:         ${String(unreasonableCount)}
Partially Reasonable: ${String(partiallyReasonableCount)}
Reasonable Rate:      ${reasonableRate}%

KEY INSIGHTS
${"-".repeat(35)}
- 5 suggestions are fully reasonable and should be implemented immediately
- 2 suggestions exhibit over-engineering concerns and should be rejected
- 2 suggestions are partially reasonable and require adjusted implementation strategies
- Overall review quality is high, but the tendency toward 'security for security's sake' should be avoided

Critic evaluation completed.
  David evaluated all ${String(evaluations.length)} reviewer comments
  Each evaluation includes detailed reasoning`);
}

try {
  criticEvaluation();
} catch (err) {
  console.error(err);
}
