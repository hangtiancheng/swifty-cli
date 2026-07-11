# 高优先级迁移审查报告 V2

审查范围: raw (mewcode) -> apps/swifty (swifty-cli)
审查日期: 2026-07-12
审查方法: 5 个并行 deep review agents, 覆盖 127 个文件对, 逐行比对
本报告是 V2 增量审查, 仅包含 V1 未覆盖的新 HIGH 结论和对 V1 HIGH 结论的补充确认

---

## V1 已报告 HIGH 结论确认状态

| V1 编号 | 结论 | V2 状态 | 备注 |
|---------|------|---------|------|
| H1 | remote/server.ts 缺少 agent-setup.ts | 确认 | V2 进一步发现 15 个功能块丢失 |
| H2 | anthropic.ts thinking 逻辑 3 处 BUG | 确认 | V2 未发现新增相关修复 |
| H3 | config.ts zod 成功路径遗漏字段 | 确认 | V2 未发现新增相关修复 |
| H4 | openai.ts tool schema 字段名错误 | 确认 | V2 未发现新增相关修复 |
| H5 | grep.ts 正则大小写敏感性变化 | 确认 + 新发现 | addon/grep.ts 保留了 `"i"` 标志, 可作为回退 |
| H6 | toolresult/record.ts 整个文件未迁移 | 已解决 | V2 grep 确认新代码库无任何 persistDecisions / DecisionRecord 引用, 可安全删除 |
| H7 | subagent/tool-filter.ts JSDoc 丢失 | 确认 | -10 行中 -4 是头注释, -6 是纯 JSDoc |
| H8 | memory.test.ts 已知失败测试 | 确认 | V2 确认 extractor.ts +154 行实现了完整的文本回退路径, 含 5 个新方法 |

---

## V2 新增 HIGH 结论 (8 项)

### 1. agent/agent.ts: 通用错误包装摧毁了 Error 子类型识别

旧文件: src/agent/agent.ts L289
新文件: src/agent/agent.ts L335-339

旧代码保留原始 Error 对象并传递给下游:

```typescript
// 旧
const e = err as Error;
yield { type: "error", error: e };
```

新代码将所有未处理错误包装为全新的泛型 Error:

```typescript
// 新
yield {
  type: "error",
  error: new Error(asErrorString(err)),
};
```

虽然 ContextTooLongError 和 RateLimitError 的自修复路径在到达此处之前已正确处理, 但最终的 catch-all 包装摧毁了原始错误的原型链、堆栈跟踪和自定义属性。下游消费 `error` 事件的代码无法再通过 `instanceof` 区分错误类型, 也无法访问 `retryAfter` 等自定义属性, 或获取有意义的堆栈信息。

注意: Agent 1 发现。这是一个只在非预期错误上触发的微妙回归, 不影响两条自修复路径。

---

### 2. permissions/checker.ts: SAFE_PREFIXES 放宽到无限制的 python/node, 导致安全回归

旧文件: src/permissions/checker.ts L50-81
新文件: src/permissions/checker.ts L54-85

旧代码限定执行变体:

```typescript
// 旧 - 受限变体
"python -c", "node -e", "bun test", "bun run", "npm test", "npm run"
```

新代码放宽到完整运行时:

```typescript
// 新 - 无限制
"bun", "deno", "pnpm", "yarn", "node", "python"
```

`isSafeCommand` 使用 `trimmed.startsWith(prefix + " ")`, 这导致:

- `python /etc/passwd` 自动允许 (旧: 仅 `python -c` 安全)
- `node malicious.js` 自动允许 (旧: 仅 `node -e` 安全)
- `bun run malicious_script` 自动允许
- `deno run dangerous_code` 自动允许 (新增运行时)
- `pnpm exec evil` 自动允许 (新增包管理器)
- `yarn dlx unsafe_pkg` 自动允许 (新增包管理器)
- `npm` 被完全移除 — `npm install`, `npm publish` 等现在需要 HITL

影响: 安全回归。放宽后的前缀实际上通过脚本语言运行时自动允许任意脚本执行。旧代码限定为 `-c`/`-e` 标志 (仅内联代码)。

---

### 3. worktree.ts: resolveRefInDir 丢失了对松散引用的递归解析

旧文件: src/worktree/worktree.ts L100-133
新文件: src/worktree/worktree.ts L148-188

旧代码对包含 `ref:` 前缀的松散引用:

```typescript
// 旧
if (content.startsWith("ref:")) {
  const target = content.slice("ref:".length).trim();
  if (!isSafeRefName(target)) return "";
  return resolveRef(dir, target); // <-- 递归解析
}
```

新代码:

```typescript
// 新
if (content.startsWith("ref:")) {
  const target = content.slice("ref:".length).trim();
  if (!isSafeRefName(target)) {
    return "";
  }
  // 缺失: return resolveRef(dir, target);
  // 穿透到 packed-refs 检查, 返回 ""
}
```

当松散引用文件包含到另一个引用的符号引用时, 旧代码递归解析链条。新代码验证了目标名称但返回空字符串, 破坏了符号引用链的分支解析。

影响: 通过松散引用文件中的中间符号引用解析的分支的 Worktree HEAD 读取会静默失败。对 `git rev-parse HEAD` 子进程的回退在大多数情况下会隐藏这个问题, 但丢失了基于文件系统解析的性能优势。

---

### 4. history.ts: load() JSONL 解析完全损坏 — z.object() 无法提取 text 字段

旧文件: src/history/history.ts L12-34
新文件: src/history/history.ts L12-33

新 `load()` 使用 `const JSONLSchema = z.object()`, 创建了一个仅校验"是否为对象?"但无字段约束的 schema。然后:

```typescript
// 新
const { text } = parse(JSONLSchema, entry);
return text; // text 永远是 undefined!
```

由于 `z.object()` 没有定义任何属性, 从结果解构 `text` 永远得到 `undefined`。`.filter(Boolean)` 也被移除, 所以数组会包含 `undefined` 值。

旧代码正确执行:

```typescript
// 旧
const entry = JSON.parse(line) as { text: string };
return entry.text;
```

这意味着提示历史加载完全损坏 — 返回 `undefined` 值数组而不是存储的提示字符串。

影响: 提示历史回顾静默损坏。用户会看到空历史。

---

### 5. remote/server.ts: 超出 agent-setup 缺失范围外的 15 项关键功能丢失

旧文件: src/remote/server.ts (1113 行)
新文件: src/remote/server.ts (469 行)

V1 H1 已覆盖缺少 agent-setup.ts 导致的远程模式不可用。V2 进一步发现, 即使 agent-setup.ts 存在, 新 server 也会缺少以下基础设施:

| # | 功能块 | 旧 | 新 |
|---|--------|-----|-----|
| 1 | 斜杠命令路由 | 动态: parseCommand 分发到 local/local_ui/prompt/skill_fork | 硬编码 buildCommandList 返回 7 项, 无实际处理逻辑 |
| 2 | 用户自定义命令 | loadUserCommands(workDir) 从 .mewcode/commands/ 加载 | 未加载 |
| 3 | 技能到命令 | wireSkillsToCommands 将技能连接到命令注册表 | 未连接 |
| 4 | 会话持久化 | 每条 user/assistant 消息通过 saveMessage(); compact 时 saveCompactBoundary() | 未持久化 |
| 5 | resume 命令 | listSessions + loadSession + rebuildFromSession + replay 完整实现 | 未支持 |
| 6 | rewind 命令 | 明确拒绝 "not yet supported in remote mode" | 未支持 |
| 7 | quit 命令 | 明确拒绝 | 未支持 |
| 8 | 计划模式 | 完整: 进入 plan mode, 创建计划文件, 运行 agent | 未支持 |
| 9 | compact 命令 | 完整: forceCompact() + 会话持久化 | 未支持 |
| 10 | Identity 覆盖 | "IDENTITY OVERRIDE: 你是 MewCode..." 注入到系统提示 | 未注入 |
| 11 | 记忆管理 | MemoryManager + MemoryExtractor + MemoryConsolidator 初始化 | 未初始化 |
| 12 | MCP 服务器 | initMCPServers() + 完整工具注册 + 指令注入 | 接收 opts 但未使用 |
| 13 | Hook 引擎 | HookEngine 初始化并传递给 agent | 未初始化 |
| 14 | 活跃技能跟踪 | activeSkills Map + SkillCatalog + LoadSkillTool | 未初始化 |
| 15 | 团队管理器 | TeamManager + TeamCreate/Send/Delete 工具 | 未注册 |

正面重构: 新 server 使用 Koa 框架 + zod schema 验证替代了原始 node:http createServer 和手动 WS 解析。旧 web.ts (805 行) 被重构为 fe/ 目录下的 React 应用, 含 rsbuild 构建配置。这是正确的架构改进, 但 agent 侧功能几乎全部缺失。

---

### 6. code-review/handler.ts: 0 行数差但存在 8 处实质差异

旧文件: src/code-review/handler.ts (368 行)
新文件: src/code-review/handler.ts (368 行)

V1 假设此文件完全相同 (0 差)。V2 发现 8 处差异:

1. 头注释替换为 logger imports (+createChildLogger)
2. 新导入 `asCriticEvaluation`, `type ReviewSession` (新类型守卫的运行时导入)
3. catch 块新增 `log.error({ err }, "code-review operation failed")`
4. `const team =` 被注释化为 `/** const team = */` (lint 屏蔽)
5. 类型断言风格: `(role === "lead" ? "lead" : "reviewer") as "lead" | "reviewer"` 改为 `role === "lead" ? ("lead" as const) : ("reviewer" as const)`
6. `String()` 数值包装 (lint 修复)
7. `addComment` 返回值变化: 响应现在包含 `JSON.stringify(comment)` — 这是 CLI 用户可见的行为变化
8. `as any` 替换为 `asCriticEvaluation()`: `evaluation.toLowerCase() as any` 改为 `asCriticEvaluation(evaluation.toLocaleLowerCase())` — 类型安全改进但同时将 `.toLowerCase()` 改为 `.toLocaleLowerCase()`

影响: 第 7 和第 8 项是微妙的行为变化。需验证测试是否覆盖修改后的 addComment 输出格式和 locale-sensitive 小写化。

---

### 7. code-review/session.ts: asCriticEvaluation 静默吞掉无效输入

旧文件: src/code-review/session.ts (530 行)
新文件: src/code-review/session.ts (557 行)

新增两个导出函数:

```typescript
export function isCriticEvaluation(str: string): str is CriticEvaluation {
  return str === "reasonable" || str === "unreasonable" || str === "partially-reasonable";
}

export function asCriticEvaluation(str: string): CriticEvaluation {
  if (isCriticEvaluation(str)) return str;
  log.error({ str }, "code-review operation failed");
  return "partially-reasonable"; // best-effort
}
```

`asCriticEvaluation` 在收到无效输入时静默返回 `"partially-reasonable"`。虽然 handler.ts L296 在调用前进行了验证, 但其他调用方可能传入无效数据。这个静默回退会掩盖编程错误。

影响: 无效评估值会被静默转换为 "partially-reasonable" 而不是抛出, 使 bug 更难检测。对于未预验证的调用方, 应考虑抛出异常。

---

### 8. tui/teammate-messsage.tsx: 文件名拼写错误 (3 个 's')

旧文件: src/tui/teammate-message.tsx (102 行)
新文件: src/tui/teammate-messsage.tsx (117 行, +15)

新文件名为 `teammate-messsage.tsx`, 包含三个连续 `s` 字符。明显的拼写错误。

除了拼写错误, 内容也有显著重构:

- `parseTeammateMessage()` 从独立的导出函数移动到组件内部, 通过 `useImperativeHandle` + `ref` 模式暴露
- `❯` unicode 字符替换为 `>` 纯 ASCII
- 组件现在接受 `ref` prop
- 新增 `PropsWithRef`, `TeammateMessageProps`, `TeammateMessageExpose` 接口

所有引用此文件的导入必须使用拼写错误的文件名。需要验证代码库中导入的一致性。

影响: 如果导入路径不一致 (部分用拼写错误, 部分不用), 会导致构建或运行时错误。

---

## V2 额外发现: 重要 MEDIUM 级别补充 (与 HIGH 相关的边界案例)

以下几项虽归为 MEDIUM, 但与 V1/V2 HIGH 结论紧密相关, 补充记录:

### A. tui/styles.ts: BORDER_COLORS 品牌色不一致

`BORDER_COLORS.focused` 仍为 `"#a78bfa"` (紫色), `BORDER_COLORS.agent` 为 `"#a855f6"` (紫色)。而其他所有品牌色都改为绿色 (#42b883)。输入框聚焦时的边框为紫色, 与绿色 UI 冲突。

### B. subagent/agent-tool.ts: forkHandler 从 await 改为 void (fire-and-forget)

旧: `const output = await this.forkHandler(...)`
新: `void this.forkHandler(...)`

forkHandler 不再被等待。fork 模式从等待完成变为永远异步且非阻塞。之前, runFork 会等待 fork handler 完成并通过 try/catch 传播其错误。现在, forkHandler 中的错误会静默丢失 (未处理的 promise 拒绝)。

### C. skills/catalog.ts: 不再支持扁平 .md 技能文件

旧: 同时扫描 `directory/SKILL.md` 和 `*.md` 文件
新: 仅扫描 `directory/SKILL.md` — 技能目录中的扁平 `.md` 文件被忽略

任何有扁平 .md 技能文件的用户 (如 `~/.swifty/skills/my-skill.md`) 会发现其技能静默不加载。

---

## 审查统计

| 来源 | 新 HIGH | 确认 V1 HIGH | 补充 MEDIUM |
|------|---------|-------------|-------------|
| Agent 1 (Core+State) | 1 | 0 | 0 |
| Agent 2 (LLM+Infra) | 4 | 3 | 2 |
| Agent 3 (Tools+Ops) | 0 | 2 | 1 |
| Agent 4 (MultiAgent+Teams) | 2 | 2 | 2 |
| Agent 5 (UI+Remote+Tests) | 1 | 1 | 3 |
| 合计 (去重) | 8 | 8 | 8 |

新 HIGH 总计: 8 项 (其中 2 项涉及安全: permissions 前缀放宽, agent.ts 错误类型丢失)
已解决 V1 HIGH: 1 项 (H6 toolresult/record.ts 已确认无引用, 可安全删除)
