# 中低优先级迁移审查报告 V2

审查范围: raw (mewcode) -> apps/swifty (swifty-cli)
审查日期: 2026-07-12
审查方法: 5 个并行 deep review agents, 覆盖 127 个文件对
本报告是 V2 增量审查, 仅包含 V1 未覆盖的 MEDIUM/LOW/INFO 结论和对 V1 结论的补充确认

V1 报告共 17 MEDIUM + 15 LOW = 32 项, 本 V2 新增 24 MEDIUM + 22 LOW + 56 INFO = 102 项

---

## V1 MEDIUM/LOW 结论确认状态

| V1 编号 | 结论 | V2 状态 |
|---------|------|---------|
| M1 | prompt/sections.ts 中文→英文翻译 -80 行 | 确认 |
| M2 | mcp/client.ts callTool 返回结构化对象 | 确认, V2 补充了 8 处额外变化 |
| M3 | sandbox/index.ts 同步→异步 | 确认 |
| M4 | worktree.ts 全部同步→异步 | 确认 |
| M5 | styles.ts 品牌色和常量全部变更 | 确认, V2 补充 BORDER_COLORS 不一致 |
| M6 | skills/builtins.ts 144 行注释死代码 | 确认 152 行 |
| M7 | team.ts XML 标签变更 + spawnTeammate 缺少 active 检查 | 确认 |
| M8 | config.ts validateProviders 成死代码 | 确认 (V2 Agent 2 将此升级为 HIGH) |
| M9 | session.ts 摘要中文→英文 | 确认, V2 补充 compact+session 翻译不一致 |
| M10 | hooks.ts 环境变量品牌重命名 | 确认 |
| M11 | permissions/checker.ts SAFE_PREFIXES 变化 | 确认 (V2 进一步发现 python/node 放宽) |
| M12 | glob.ts exclude 逻辑额外过滤 dotfile | 确认 (迁移到 @swifty.js/glob-wasm) |
| M13 | tool-search.ts 输出格式变 JSON | 确认 |
| M14 | consolidation.ts console.log 残留 | 确认, V2 发现额外 2 处 console.error |
| M15 | skills/catalog.ts 技能路径 2→8 | 确认 |
| M16 | spawn.ts 函数名大小写 | 确认 |
| M17 | model enum 约束移除 | 确认 |
| L18 | 品牌重命名 100% 完成 | 确认 |
| L19 | bun:test → vitest 全部 23 文件完成 | 确认 |
| L21 | pino 日志集成质量良好 | 确认, V2 补充 3 处额外 console 残留 |
| L22 | 文件头注释移除所有文件 | 确认 |
| L23 | Tool.execute 参数顺序全部 16+5 工具已适配 | 确认 |
| L24 | definition.ts omitMewcodeMd 移除 | V2 重命名为 omitMarkdown |
| L25 | write-file.ts 输出消息变化 | 确认 |
| L27 | print-mode.ts 逻辑完全一致 | 确认 |
| L28 | conversation.ts 品牌更新 | 确认, V2 补充 whitespace 变化 |
| L29 | 新增模块缺专门测试 | 确认 |
| L30 | 依赖现代化 | 确认 |
| L31 | 目录重命名全部完成 | 确认 |
| L32 | 跨文件通用改进 | 确认 |

---

## V2 新增 MEDIUM 结论 (16 项)

### 1. agent/agent.ts: MaxTokensSetter 类型移除

旧: 使用 `as Partial<MaxTokensSetter>` 保护可选方法调用
新: 直接在 client 上调用 `setMaxOutputTokens?.`, 依赖接口声明 optional

类型层面的正确清理, 行为不变。

---

### 2. compact.ts: AUTO_COMPACT_THRESHOLD 注释代替删除

```typescript
// 旧
const AUTO_COMPACT_THRESHOLD = 0.8;
// 新
// const AUTO_COMPACT_THRESHOLD = 0.8;
```

注释残留而非删除。装饰性, 无行为影响。

---

### 3. compact.ts + session.ts: English 摘要文案不一致

compact.ts doCompact: "This session continues from a previous conversation..."
session.ts rebuildFromSession: "This session is the previous conversation..."

第二句语法较弱。模型在会话压缩 vs 会话恢复场景收到不同的框架文本。

---

### 4. conversation.ts: system-reminder whitespace 变化

旧: 紧凑单行字符串拼接
新: 多行模板字符串, 带缩进

XML 标签内的空白发生了变化, `<system-reminder>` 内的行现在有 2 空格缩进。`IMPORTANT:` 行从 6 空格缩进改为 2 空格。LLM 会看到略微不同的系统提示格式。

---

### 5. consolidation.ts: 额外 2 处 console.error 残留 (V1 M14 之外)

旧: 静默 `catch {}` 块
新: `console.error(err)` — 绕过了已集成的 pino logger

V1 M14 捕获了 subagent drain 循环的 console.log。这 2 处额外的 console.error 是独立的残留:

- L182 tryAcquireLock catch 块
- L219 rollbackLock catch 块

应迁移到 `log.error({ err })`。

---

### 6. main.tsx: 光标管理和 TTY 处理脆弱

新增约 30 行 TTY 光标管理:

1. 直接打开 `/dev/tty` (`openSync("/dev/tty", "w")`)
2. 补丁 `cliCursor.show` 为 noop
3. 手动通过 `writeTty("\x1b[?25l")` 隐藏光标
4. 在 `process.on("exit")` 注册 `restoreCursor`
5. `instance.waitUntilExit()` 后的 `restoreCursor` 被注释

光标恢复完全依赖 `process.on("exit", restoreCursor)`, 依赖进程退出时序, 较脆弱。当 TUI 通过 Ink 正常退出时可能状态不一致。

---

### 7. openai.ts: strict 字段从 false 变为 null

旧: `strict: false` (显式关闭)
新: `strict: null` (使用服务端默认)

可能导致 OpenAI 兼容端点在 null 解释为"使用默认"时开启 strict 模式。

---

### 8. anthropic.ts: 消息合并 in-place mutation + 变量重赋值模式脆弱

旧: 假设 content 始终是数组
新: 处理 string content 类型, 但采用 `content = prev.content = [...]` 模式

同时修改 prev.content 并重新赋值本地变量。如果 Anthropic SDK 曾返回冻结的 content 数组, 此修改会静默失败。正确但脆弱。

---

### 9. hooks.ts: execSync 改为 async exec, 但 encoding 缺失

旧: `execSync(command, { encoding: "utf-8", ... })`
新: `await execHookAsync(command, { env: {...} })` — 未设置 `encoding: "utf-8"`

Node 的 `exec` 在无 encoding 时返回 Buffer 而非 string。Buffer 有 `.trim()` 但语义不同。可能在 hook 输出处理时产生微妙问题。

---

### 10. hooks.ts: prompt 类型 hook 现在传播 hook.reject

旧: 硬编码 `reject: false`
新: `reject: hook.reject ?? false` (尊重配置)

这是一个 bug 修复。任何配置了 `reject: true` 的 prompt 类型 hook 现在能实际工作。

---

### 11. skills/executor.ts: JSDoc 声称不存在的 fail-fast 行为

```
Fail-fast: Throws an error if any tools in allowedTools are unregistered
```

但 runInline 的签名不接受也不验证 allowedTools。API 变化: `host.runSubAgent(prompt)` 重命名为 `host.runSubagent(prompt)`, 与 skill.ts 接口同步。

---

### 12. skills/builtins.ts: 144→158 行, V1 M6 补充

完整 152 行注释代码被提交: loadBuiltinFile (30 行), parseBuiltinSkill (20 行), 4 个内置技能定义, loadBuiltinSkills。虽然 src/skills/builtin/ 下的 SKILL.md 文件存在且可加载, 但 loader 代码被注释, 所以它们不会被加载。

---

### 13. skills/catalog.ts: 不再扫描扁平 .md 技能文件

旧: 同时扫描 directory/SKILL.md 和 *.md 文件
新: 仅扫描 directory/SKILL.md

---

### 14. skills/catalog.ts: allowedTools 字段在 parseSkillFile 中被注释

```typescript
// allowedTools: data.allowed_tools,
```

YamlFrontmatterSchema 定义了 allowed_tools, 但元数据映射中被注释。使用 allowed_tools 的技能配置会静默被忽略。

---

### 15. skills/catalog.ts: scanDirectory/loadSkill 改为 public

旧: `private` 访问修饰符
新: 无访问修饰符 (默认 public)

如果这些方法现在成为公共 API 的一部分, 未来的签名变化会成为破坏性变更。

---

### 16. subagent/agent-tool.ts: forkHandler 从 await 改为 fire-and-forget

旧: `const output = await this.forkHandler(...)`
新: `void this.forkHandler(...)`

fork 模式现在永远异步且非阻塞。之前错误会通过 try/catch 传播, 现在会静默丢失 (未处理 promise 拒绝)。

---

## V2 新增 LOW 结论 (14 项)

### 17. agent/agent.ts: MaxTokensSetter 类型移除 (已在 MEDIUM 详述)

类型层面清理, 无行为影响。

---

### 18. plan-file.ts: loadPlan 签名变更, 移除未使用的 workDir 参数

旧: `loadPlan(workDir: string)`
新: `loadPlan()`

旧实现中 workDir 未被使用, 移除正确。调用方已更新。

---

### 19. tui/styles.ts: BORDER_COLORS 不一致

`BORDER_COLORS.focused` (`#a78bfa`) 和 `BORDER_COLORS.agent` (`#a855f6`) 仍为紫色, 与其他绿色品牌色 (#42b883) 不匹配。

---

### 20. tui/verbs.ts: 4 个 spinner verb 和 1 个 completion verb 被删除

旧: 106 spinner verbs + 20 completion verbs
新: 102 spinner verbs + 19 completion verbs

被删除的包括 "Bloviating", "Hullaballooing"。每个动词现在都有中文翻译注释, 与代码库英文化方向不一致。

---

### 21. tui/plan-approval.tsx: 0 行数差但存在差异

V1 假设相同。实际存在 6 处差异: 品牌名 (MewCode→Swifty), prompt 字符 (❯→>), 光标字符 (█→|), consts 重命名, props 模式。

---

### 22. examples/review-agent-code.ts: 未迁移

6 个 example 文件中唯一未迁移的。仍使用中文注释 (改进建议1/2/3), emoji (✅, 👤, 🎯), 和 `async -> .catch(console.error)` 模式。

---

### 23. code-review/session.ts: `||` 改为 `??` (nullish coalescing)

旧: `comment.resolution || "pending"`
新: `comment.resolution ?? "pending"`

语义不同: 旧对空字符串使用 "pending", 新不会。需确认没有代码路径产生空字符串的 CommentResolution。

---

### 24. code-review/session.ts: 广泛 emoji 替换为 ASCII

getCriticSummary 和 formatFinalReport 中约 40+ emoji 替换为 ASCII 字母 (✅→Y, ❌→N, ⚠️→!, 💬→*)。报告输出外观显著改变。

---

### 25. code-review/session.ts: 非空断言替换为显式 null 检查

旧: `const feedback = fileFeedback.get(fileName)!`
新: `const feedback = fileFeedback.get(fileName); if (!feedback) continue;`

更好的安全性, 无功能变化。

---

### 26. code-review/handler.ts: addComment 响应变啰嗦

旧: "Added comment to request '${requestId}'"
新: "Added comment ${JSON.stringify(comment)} to request '${requestId}'"

整个评论对象 (包括 id, timestamp, criticAssessments: []) 被序列化到 CLI 响应。

---

### 27. subagent/spawn.ts: spawnSubAgent 重命名为 spawnSubagent (小写 'a')

与 skill.ts 的 runSubagent 同步重命名。

---

### 28. subagent/agent-tool.ts: model enum 移除

旧: `enum: ["sonnet", "opus", "haiku"]`
新: 无 enum

模型覆盖验证从 schema-time 移到 resolveModelId() 调用时。

---

### 29. subagent/definition.ts: omitMewcodeMd 重命名为 omitMarkdown

更通用的名字, 因为不再特定于 .mewcode.md。需确认所有消费者已更新。

---

### 30. 全局: `❯` 提示字符替换为 `>`

涉及: styles.ts, plan-approval.tsx, teammate-messsage.tsx, provider-select.tsx, permission-dialog.tsx, teams-dialog.tsx。原因: 避免 Windows 终端 Unicode 渲染问题。

---

### 31. 全局: `█` 块光标替换为 `|` 管道

tui/plan-approval.tsx L81。同上原因。

---

## V2 新增 INFO 结论 (56 项摘要)

按模块分组列出:

### 新增模块

- logger/: 6 个文件 (logger.ts, child.ts, context.ts, serializers.ts, cleanup.ts, index.ts) — 425 行, pino 日志完整实现
- tools/addon/glob.ts: 100 行, @swifty.js/glob-addon 同步 glob 实现 (保留 `"i"` 标志)
- tools/addon/grep.ts: 169 行, @swifty.js/glob-addon grep 实现
- tui/is-diff-tool.ts: 4 行, 从 diff-render.tsx 提取的 `isDiffTool` 类型守卫
- tui/status-bar.tsx: 43 行, 从 app.tsx 提取的状态栏组件, 显示模式+token 计数
- skills/builtin/: 5 个 SKILL.md 文件 (commit 41 行, fullstack-interview 105 行, test 42 行, teach-me 399+244 行) — 注意: loader 被注释, 未启用

### main.tsx 新增清单 (+72 行)

- pino logger init/imports: ~5 行
- asErrorString 用法: ~3 行
- 远程地址解析: ~9 行 (`--remote <addr>`)
- RemoteServer init + keep-alive 移除: ~6 行
- TUI logger init: ~1 行
- TTY 光标管理: ~30 行
- 错误生命周期处理: ~18 行 (catch, exit, unhandledRejection, uncaughtException)
- 注释掉 keep-alive: ~2 行

### 测试框架现代化

- bun:test → vitest 全部 23 个 .test.ts 文件完成
- run-e2e.sh → run-e2e.mjs (+134 行, shell→ESM 重写)
- run-failing.sh → run-failing.mjs (+134 行, shell→ESM 重写)
- planfile.test.ts 重命名为 plan-file.test.ts
- toolresult.test.ts 重命名为 tool-result.test.ts
- install-skill.test.ts: +14 行, execute() 签名变化 (ctx 参数分离)
- openai-compat.test.ts: +21 行, 用 Zod safeParse 替代类型断言
- memory.test.ts: +1 行, 测试逻辑相同, 写入路径从 .mewcode/memory 改为 .swifty/memory

### 类型安全改进

- `(err as Error).message` → `asErrorString(err)` (跨所有 catch 块)
- 隐式数值转换 → 显式 `String(value)` (跨所有模板字符串)
- `!` 非空断言 → `?.` 可选链 (部分源文件和测试)
- 单行 if/for → 加花括号 (全局格式化)
- `Record<string, unknown>` → `ToolSchema` (所有 Tool.schema() 返回)

### 跨文件品牌重命名明细

| 旧 | 新 |
|----|----|
| `.mewcode/` | `.swifty/` |
| `.mewcode/config.yaml` | `.swifty/config.y(a)ml` (新增 .yml 支持, 6 个候选路径) |
| `.mewcode/sessions/` | `.swifty/sessions/` |
| `.mewcode/plans/` | `.swifty/plans/` |
| `.mewcode/skills/` | `.swifty/skills/` (扩展到 8 个路径) |
| `.mewcode/permissions.yaml` | `.swifty/permissions.yaml` |
| `.mewcode/worktrees/` | `.swifty/worktrees/` |
| `.mewcode/commands/` | `.swifty/commands/` |
| `.mewcode/toolresult.jsonl` | (已删除, 无 orphan 引用) |
| `mewcode-` (tmux session) | `swifty-` |
| `MEWCODE_EVENT` | `SWIFTY_EVENT` |
| `MEWCODE_TOOL` | `SWIFTY_TOOL` |
| `MEWCODE_FILE_PATH` | `SWIFTY_FILE_PATH` |
| `MEWCODE_TEST_API_KEY` | `SWIFTY_TEST_API_KEY` |
| `MewCode` | `Swifty` |
| `MEWCODE.md` | `SWIFTY.md` |
| `MEWCODE.local.md` | `SWIFTY.local.md` |
| `alice/bob/charlie` (code-review 默认名) | `swifty.go/swifty.qa/swifty.js` |

### zod 校验新增实例

| 模块 | 新增 Schema |
|------|------------|
| session.ts | SessionMessageSchema, KeptMessageSchema, CompactBoundaryPayloadSchema |
| memory/manager.ts | 2 个新 schema |
| ask-user.ts | QuestionSchema (safeParseAsync) |
| permissions/checker.ts | YamlEntrySchema (z.array) |
| commands/loader.ts | YamlFrontmatterSchema |
| skills/catalog.ts | YamlFrontmatterSchema |
| code-review/manager.ts | CodeReviewMemberSchema, CodeReviewTeamSchema |
| teams/file-mailbox.ts | FileMailMessageSchema, ErrnoExceptionSchema |
| commands/usage-tracker.ts | UsageEntrySchema (safeParse) |
| todo/store.ts | TaskSchema (z.array().safeParse) |
| history.ts | JSONLSchema (BUG: z.object() 无字段定义) |

### 依赖新增与版本升级

| 包 | 旧版本 | 新版本 | 说明 |
|----|--------|--------|------|
| @anthropic-ai/sdk | ^0.99.0 | ^0.104.2 | |
| ink | ^5.2.0 | ^7.1.0 | |
| react | 18 | 19.2.7 | |
| typescript | ^5.8.3 | ^5.9.3 | |
| openai | ^6.39.0 | ^6.45.0 | |
| marked | ^15.0.7 | ^18.0.5 | |
| pino | 新增 | ^10.3.1 | 结构化日志 |
| zod | 新增 | ^4.4.3 | 运行时校验 |
| koa | 新增 | ^3.2.1 | HTTP 框架 |
| vitest | 新增 | ^4.1.10 | 测试 |
| tsup | 新增 | ^8.5.1 | 构建 |
| tailwindcss | 新增 | ^4.3.2 | 样式 |
| @swifty.js/marked-terminal | 新增 | workspace:* | 替代 types/marked-terminal.d.ts |
| @swifty.js/glob-wasm | 新增 | workspace:* | 替代 Bun.Glob |
| @swifty.js/glob-addon | 新增 | workspace:* | 备选 glob |
| @types/bun | ^1.2.14 | 移除 | |

### 文件头注释移除明细 (全部文件确认)

| 文件 | 行数差 |
|------|--------|
| llm/errors.ts | -5 (含 1 行 retryAfter 类型严格化) |
| llm/events.ts | -4 |
| llm/model-resolver.ts | -2 (含 1 行 "Short aliases" 注释) |
| sandbox/bwrap.ts | -5 |
| sandbox/seatbelt.ts | -5 |
| skills/executor.ts | -3 (含 1 行空白) |
| skills/skill.ts | -5 (含 1 行 inline 注释 + 2 行空白) |
| tui/styles.ts | -5 |
| prompt/sections.ts | -80 (含翻译压缩) |

### TUI 重构明细

| 文件 | 旧 | 新 | 变化类型 |
|------|-----|-----|---------|
| app.tsx | 1737 | 1855 | +child logger, status-bar, is-diff-tool |
| chat.tsx | 341 | 393 | +child logger, status-bar import |
| input.tsx | 516 | 574 | +child logger, props 重构 |
| ask-user-dialog.tsx | 465 | 485 | +logger, props |
| permission-dialog.tsx | 69 | 62 | -React import, -空白 |
| diff-render.tsx | 43 | 34 | -isDiffTool 提取 |
| teams-dialog.tsx | 200 | 193 | -React, -summarizeActivities |
| provider-select.tsx | 48 | 44 | -React |
| scroll-box.tsx | 37 | 34 | -React |
| teammate-messsage.tsx | 102 | 117 | +ref hook, +ASCII |
| teammate-spinner-tree.tsx | 35 | 31 | -React |
| team-status.tsx | 23 | 19 | -React |
| verbs.ts | 142 | 134 | -4 verbs +中文注释 |

### Tool.execute 参数顺序适配完整清单

所有 21 个 Tool 实现已验证从 `execute(args, ctx)` → `execute(ctx, args)`:
BashTool, ReadFileTool, EditFileTool, WriteFileTool, GlobTool, GrepTool, AskUserTool, ToolSearchTool, EnterWorktreeTool, ExitWorktreeTool, ExitPlanModeTool, AgentTool, TeamCreateTool, SpawnTeammateTool, SendMessageTool, ListTeamsTool, TeamDeleteTool, InstallSkillTool, LoadSkillTool, MCPToolWrapper, TodoTools (3 个)

### glob 实现迁移

旧: `Bun.Glob` (Bun 专用, scanSync)
新:
- 主 `tools/glob.ts`: `@swifty.js/glob-wasm` (WASM, async scan)
- 备选 `tools/addon/glob.ts`: `@swifty.js/glob-addon` (native addon, scanSync)
- 主 `tools/grep.ts`: 同上 + 移除 `"i"` 标志
- 备选 `tools/addon/grep.ts`: 同上 + 保留 `"i"` 标志

---

## 审查统计

| 来源 | 新 MEDIUM | 新 LOW | 新 INFO |
|------|-----------|--------|---------|
| Agent 1 (Core+State) | 3 | 4 | 3 |
| Agent 2 (LLM+Infra) | 4 | 3 | 4 |
| Agent 3 (Tools+Ops) | 2 | 2 | 0 (inline) |
| Agent 4 (MultiAgent+Teams) | 5 | 2 | 1 |
| Agent 5 (UI+Remote+Tests) | 2 | 10 | 48 |
| 合计 (去重) | 16 | 15 (含合并) | 56 |

总体迁移完整度估计 V2: 约 88% (V1 估计 92%, V2 发现额外问题)
主要新增阻塞项:
1. history.ts JSONL 解析 100% 损坏 (HIGH)
2. permissions/checker.ts SAFE_PREFIXES 放宽 (HIGH)
3. remote/server.ts 缺少 15 项关键功能 (HIGH)
4. agent.ts 错误类型丢失 (HIGH)
主要新增推荐项:
1. 修复 BORDER_COLORS 紫色残留
2. addon/grep.ts 保留 `"i"` 标志, 可作为回退方案
3. 移除 skills/builtins.ts 152 行注释死代码
4. 恢复 skills/builtin/ 内置技能加载器
