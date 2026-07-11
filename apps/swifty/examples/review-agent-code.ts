import { CodeReviewManager } from "../src/code-review/manager.js";
import { TeamManager } from "../src/teams/team.js";
import { ReviewSession } from "../src/code-review/session.js";

async function reviewAgentCode() {
  const workDir = process.cwd();
  const teamManager = new TeamManager(workDir);
  const manager = new CodeReviewManager(workDir, teamManager);
  const session = new ReviewSession(workDir, manager);

  // Create a review request for the agent.ts file
  const request = session.createReviewRequest(
    "security-review-team",
    "Review src/agent/agent.ts code quality",
    "Please review the Agent class implementation for code quality, security, and best practices",
    "developer-team",
    "main",
    ["src/agent/agent.ts"],
  );

  console.log("🎯 Code Review Request Created:");
  console.log(`   Request ID: ${request.id}`);
  console.log(`   Title: ${request.title}`);
  console.log(`   Reviewers: ${request.reviewers.join(", ")}`);

  // Bob (Reviewer 1) adds comments focusing on testing, code-quality, documentation
  console.log("\n👤 Bob (Reviewer) adding code quality evaluation:");

  const bobComment1 = session.addComment(
    request.id,
    "bob",
    "代码质量评价：整体结构清晰，但缺少错误处理的边界情况测试。建议为 executeTools 方法添加单元测试，特别是针对权限检查失败、hook 拒绝、工具执行超时等场景。",
    "src/agent/agent.ts",
    135,
  );

  const bobComment2 = session.addComment(
    request.id,
    "bob",
    "改进建议1：在 run() 方法中添加更详细的错误处理日志。当前 catch 块只是简单地 yield error，建议记录错误上下文信息（如当前工具、参数、状态）以便调试。",
    "src/agent/agent.ts",
    102,
  );

  const bobComment3 = session.addComment(
    request.id,
    "bob",
    "改进建议2：为 AgentConfig 接口添加 JSDoc 注释，说明每个配置项的作用和默认值。特别是 onPermissionRequest 回调的返回值含义需要文档说明。",
    "src/agent/agent.ts",
    9,
  );

  const bobComment4 = session.addComment(
    request.id,
    "bob",
    "改进建议3：考虑添加配置验证机制，在构造函数中验证必需的配置项（如 client、registry、conversation）是否存在，避免运行时出现 undefined 错误。",
    "src/agent/agent.ts",
    33,
  );

  // Charlie (Reviewer 2) adds comments focusing on TypeScript, backend, api-security
  console.log("\n👤 Charlie (Reviewer) adding technical expertise evaluation:");

  const charlieComment1 = session.addComment(
    request.id,
    "charlie",
    "代码质量评价：TypeScript 类型使用良好，但存在一些潜在的类型安全问题。toolSchemas 在循环外获取，如果工具注册表在运行时动态变化，可能导致 schema 不一致。",
    "src/agent/agent.ts",
    44,
  );

  const charlieComment2 = session.addComment(
    request.id,
    "charlie",
    "改进建议1：将 toolSchemas 的获取移到工具执行前，或者添加缓存失效机制。考虑在工具执行时动态获取最新的 schema，确保与实际可用工具保持同步。",
    "src/agent/agent.ts",
    44,
  );

  const charlieComment3 = session.addComment(
    request.id,
    "charlie",
    "改进建议2：在 executeTools 方法中添加工具执行超时控制。当前没有超时机制，恶意或卡死的工具可能导致整个 Agent 循环阻塞。建议为每个工具执行设置合理的超时时间。",
    "src/agent/agent.ts",
    135,
  );

  const charlieComment4 = session.addComment(
    request.id,
    "charlie",
    "改进建议3：增强安全性，对 toolName 和 arguments 进行输入验证和清理。虽然 PermissionChecker 已经处理了大部分安全问题，但建议在工具执行前添加额外的参数类型验证，防止类型混淆攻击。",
    "src/agent/agent.ts",
    160,
  );

  const charlieComment5 = session.addComment(
    request.id,
    "charlie",
    "安全建议：在权限检查通过后，工具执行前，建议添加操作审计日志。记录谁在什么时间执行了什么工具，这对安全审计和问题追踪很重要。",
    "src/agent/agent.ts",
    177,
  );

  // Accept some critical suggestions
  session.acceptComment(
    request.id,
    bobComment2.id,
    "同意添加更详细的错误处理日志，将在下个版本实现",
  );
  session.acceptComment(request.id, bobComment3.id, "会添加完整的 JSDoc 注释");
  session.acceptComment(request.id, charlieComment2.id, "这是一个好建议，会实现动态 schema 获取");
  session.acceptComment(request.id, charlieComment3.id, "会添加工具执行超时控制");
  session.acceptComment(request.id, charlieComment5.id, "安全审计日志很重要，会实现");

  // Reject some suggestions with reasoning
  session.rejectComment(
    request.id,
    bobComment1.id,
    "单元测试已经在单独的测试文件中规划，agent.ts 保持简洁",
  );
  session.rejectComment(
    request.id,
    bobComment4.id,
    "TypeScript 的类型系统已经提供了基本的编译时验证",
  );
  session.rejectComment(
    request.id,
    charlieComment1.id,
    "工具注册表在运行时不会动态变化，当前设计是安全的",
  );
  session.rejectComment(
    request.id,
    charlieComment4.id,
    "PermissionChecker 已经包含了参数验证，避免重复",
  );

  // Generate final report
  const summary = session.generateFinalReport(request.id);
  const report = session.formatFinalReport(summary);

  console.log(report);

  // Update request status to approved
  session.updateRequestStatus(request.id, "approved");

  console.log("\n✅ Code review completed!");
  console.log(`   Total Comments: ${summary.totalComments}`);
  console.log(`   Accepted: ${summary.acceptedSuggestions}`);
  console.log(`   Rejected: ${summary.rejectedSuggestions}`);
  console.log(`   Final Status: ${summary.overallConclusion.toUpperCase()}`);
}

reviewAgentCode().catch(console.error);
