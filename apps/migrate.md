# swifty → larky 全量迁移改造记录

> 日期：2026-07-26
> 目标：将 `apps/swifty`（单进程全功能 CLI agent，~29k 行）全量迁入 `apps/larky`，**完全丢弃 larky 旧业务实现，仅保留其双进程架构骨架**。
> 原始计划文件：`~/.qoder/plans/fresh-jungle-widgeon.md`
> 结果：typecheck / build 全绿；41 个测试文件 268 个用例全部通过；真实 LLM 端到端冒烟通过。

---

## 一、总体架构（迁移后）

```
 +------------------------------+    TCP JSON-RPC / NDJSON     +--------------------------------+
 |  客户端进程 dist/cli/main.js |  <=========================> |  daemon 进程 dist/core/app.js   |
 |  模式分派:                   |       127.0.0.1:5520         |  CoreApp                        |
 |   · TUI(默认, socket 客户端) |                              |   · AgentSession (每会话一个)    |
 |   · -p print (进程内)       |   事件: agent.*, run.*,      |     持有 swifty 完整 Agent 栈:   |
 |   · --teammate (进程内)     |   permission.requested ...   |     client/conv/registry/checker|
 |   · --remote (进程内)       |   RPC: session.*, run.cancel |     hooks/skills/teams/memory/  |
 |   · ping/core/trace 子命令  |   permission.respond ...     |     fileHistory/mcp/sandbox     |
 |  本地能力: 输入历史/@补全/   |                              |   · pending maps (交互桥接)     |
 |  鼠标滚动/主题/渲染          |                              |   · events.jsonl 落盘 + replay  |
 +----------------------------+                              +--------------------------------+
```

关键设计（均源自 swifty `remote/server.ts` 已验证的模式）：

1. **Agent 状态封装为 per-session Handle**（`core/agent-session.ts`），daemon 内 `for await agent.run()` 消费 AsyncGenerator，逐事件桥接为 wire 事件。
2. **阻塞式 UI 回调 → pending-map 模式**：`onPermissionRequest` / `AskUserQuestionTool` 的 Asker / plan 审批，daemon 生成带 `id` 的事件推给客户端，`Map<id, resolver>` 挂起 Promise，客户端经 `*.respond` RPC 回答后 resolve。
3. **中断**：`run.cancel` RPC → daemon 侧 `AbortController.abort()`。
4. **断连兜底（B-3）**：最后一个订阅客户端断开时，取消全部 pending 交互（权限→deny、ask→空答案、plan→reject），agent 永不冻结。
5. **事件回放（B-11）**：每个 run 的事件落盘到 `<workDir>/.swifty/daemon/runs/<runId>/events.jsonl`；客户端重连时 `event.subscribe` 带 `replay_from_run` 同步快照回放（快照与订阅之间无 await 间隙，不丢事件）。
6. **双 id 设计**：`AgentSession.id`（wire 会话 id，`sess-xxx`，稳定不变，用于事件路由）与 `AgentSession.swiftyId`（swifty 持久化会话 id，`/clear` 和 resume 时更换）分离。

命名约定（与用户确认）：代码保持 **swifty 命名**（`.swifty/` 配置目录、`IDENTITY OVERRIDE: You are Swifty`、`__SWIFTY_VERSION__` 等），便于直接拷贝；package 名保持 `@swifty.js/larky`、bin 保持 `larky`。后续品牌替换由用户自行全局替换。`apps/swifty` 目录保留未动。

---

## 二、Phase 0 — 骨架清理与代码搬运

### 2.1 删除的 larky 旧业务代码（`git rm`，可从 git 历史恢复）

**src/core/ 下删除**（旧的 plan-act-observe 精简实现，全部丢弃）：

```
core/app.ts            (旧 CoreApp, 456 行 — 后重写)
core/context.ts        (ExecutionContext)
core/loop.ts           (AgentLoop)
core/runner.ts         (AgentRunner)
core/runs.ts
core/errors.ts
core/llm/              (base.ts, provider.ts=AnthropicProvider, types.ts)
core/prompt/           (builder.ts, sections.ts ← 含 2 行未提交修改「Larky 身份锁定」，经确认随旧实现一并丢弃)
core/tools/            (base.ts, registry.ts, invocation.ts, errors.ts,
                        builtin/: bash, read-file, write-file, list-dir, note-save,
                        task-create/get/list/update, index)
core/permissions/      (manager.ts, policy.ts, storage.ts, errors.ts)
core/session/          (manager.ts, store.ts, model.ts)
core/compact/          (compactor.ts, budget.ts)
core/subagent/         (tool.ts, registry.ts)
core/agents/           (loader.ts + builtin/{planner,executor,reviewer}.toml)
core/skills/           (loader.ts + builtin/{init,orchestrate,review,summarize}.md)
core/mcp/              (client.ts, server.ts, tool.ts)
core/task/             (manager.ts, model.ts)
core/memory/           (loader.ts)
core/trace/provider.ts (TracingProvider — 依赖旧 llm 层)
```

**src/cli/ 下删除**：`main.ts`（后重写）、`commands/chat.ts`、`commands/run.ts`

**src/tui/ 整目录删除**（旧 929 行 TUI，17 文件）：app.tsx, bootstrap.ts, index.ts, chat.tsx, input.tsx, tool-display.tsx, permission-dialog.tsx, sync-output.ts, verbs.ts, spinner.tsx, at-expand.ts, mouse.ts, theme.ts, styles.ts, diff-render.tsx, scroll-box.tsx, is-diff-tool.ts

**tests/ 下删除 41 个旧测试**（对应已删业务模块）：
agent-profile-loader, app-subscribe, budget, builtin-tools, commands-events, compactor, context-system-prompt, context, dual-process(旧版), invocation, llm-provider, loop, mcp-tool, memory-loader, note-save-tool, permission-flow, permission-manager, permission-policy, permission-storage, ping-roundtrip, prompt-builder, read-file, run-e2e, runner, runs, session-ipc, session-manager, session-model, session-store, skill-loader, spawn-agent-tool, stdout-printer, subagent-registry, task-builtin-tools, task-manager, task-model, tool-params, tool-registry, tool-retry, tracing-provider, tui-components

### 2.2 保留的 larky 架构骨架（仅这些）

```
src/core/transport/socket-server.ts    TCP + NDJSON + JSON-RPC 分发 (后修 1 个 bug)
src/core/transport/socket-client.ts    客户端: sendCommand/onEvent/waitForDisconnect
src/core/transport/ipc-broadcaster.ts  订阅广播: picomatch topic + scope + B-10 串行写队列 (后扩展)
src/core/bus/envelope.ts               JSON-RPC 2.0 帧/错误码/HandlerError
src/core/bus/commands.ts               (Phase 1 全部重写)
src/core/bus/events.ts                 (Phase 1 全部重写)
src/core/bus/index.ts                  (Phase 1 重写导出)
src/core/events/bus.ts                 EventBus (发布订阅)
src/core/events/writer.ts              EventWriter (JSONL 落盘)
src/core/trace/writer.ts               TraceWriter
src/core/trace/record.ts               trace 记录工厂
src/core/commands/ping.ts              pingDaemon / cmdPing
src/core/config.ts                     larky 基础配置 (host/port/logging/trace, LARKY_* env)
src/core/logging.ts                    pino + 同步轮转文件日志
src/cli/commands/core.ts               daemon 生命周期 (PID 文件/ensureDaemonRunning/
                                       stopDaemonOnExit/B-12 PID 复用防护)
src/cli/commands/trace.ts              larky trace 子命令
src/cli/commands/version.ts
src/dev.ts                             双进程 dev 启动器 (fork daemon + 前台 TUI)
src/version.ts                         (__LARKY_VERSION__ 注入)
scripts/gen-protocol-doc.ts            (Phase 1 重写)
kill.mjs
```

保留的架构层测试 9 个：config-env, envelope, event-bus, event-writer, ipc-broadcaster, logging, socket-client, socket-server, trace-writer（其中 5 个后续因事件 schema 变更做了字段修正，见 4.4）。

### 2.3 从 swifty 拷贝的业务模块（`cp -R`，共 28 个目录 + 3 个文件）

实际执行的拷贝命令（在 `apps/` 目录下）：

```bash
cd /Users/hangtiancheng/github/swifty-cli/apps

# 28 个业务模块目录（整目录递归拷贝）
for d in agent llm conversation tools tool-result prompt permissions sandbox \
         config session compact memory skills commands subagent teams hooks \
         mcp worktree code-review file-history plan-file todo history logger \
         utils tui remote; do
  cp -R swifty/src/$d larky/src/$d
done

# 3 个顶层单文件（main.tsx 仅作 Phase 3 重写参考，随后删除）
cp swifty/src/print-mode.ts swifty/src/teammate.ts swifty/src/main.tsx larky/src/
```

| 目录/文件 | 内容 |
|---|---|
| `agent/` | agent.ts(786 行, 主循环+streaming), streaming-executor.ts, events.ts (AgentEvent) |
| `llm/` | client.ts, anthropic.ts, openai.ts, model-resolver.ts, errors.ts, events.ts (anthropic/openai/openai-compat 三协议) |
| `conversation/` | conversation.ts, pairing.ts |
| `tools/` | read-file, bash(沙箱), glob, grep(WASM 加速), write-file, edit-file, diff, ask-user, tool-search(deferred tools), enter/exit-worktree, exit-plan-mode, synthetic-output, registry, types, file-state-cache, addon/ |
| `tool-result/` | budget.ts (工具输出预算/超 50k 溢写磁盘) |
| `prompt/` | builder.ts, sections.ts, plan-mode.ts, coordinator.ts |
| `permissions/` | checker.ts (524 行, 模式/规则/危险命令模式匹配) |
| `sandbox/` | index.ts, seatbelt.ts (macOS), bwrap.ts (Linux) |
| `config/` | config.ts (zod+YAML, ~/.swifty → 项目 .swifty → config.local.yml 三级合并) |
| `session/` | session.ts (JSONL 持久化/resume 重建/compact boundary) |
| `compact/` | compact.ts (forceCompact), recovery.ts (RecoveryState) |
| `memory/` | manager.ts, extractor.ts, consolidation.ts, instructions.ts, memory-age.ts (长期记忆) |
| `skills/` | catalog.ts, executor.ts (runInline/runFork), install-tool.ts, load-skill-tool.ts, builtins.ts, skill.ts, builtin/ (SKILL.md 资产) |
| `commands/` | commands.ts (内置 slash 命令注册表+parse), loader.ts (用户 .md 命令), usage-tracker.ts |
| `subagent/` | agent-tool.ts, spawn.ts, loader.ts, tool-filter.ts, task-manager.ts, definition.ts |
| `teams/` | team.ts, tools.ts, task-tools.ts, file-mailbox.ts, backend.ts, protocol.ts, shared-task.ts, transcript.ts, coordinator.ts, progress.ts, registry.ts, task-stop.ts, team-file.ts (13 文件) |
| `hooks/` | hooks.ts (HookEngine + validate) |
| `mcp/` | manager.ts, client.ts, tool-wrapper.ts |
| `worktree/` | worktree.ts (git worktree 隔离) |
| `code-review/` | session.ts, handler.ts, manager.ts |
| `file-history/` | file-history.ts (快照/rewind) |
| `plan-file/` | plan-file.ts (getOrCreatePlanPath/loadPlan/resetPlanPath 等) |
| `todo/` | todo.ts (TaskList), store.ts (TaskStore), tools.ts (TaskCreate/Get/List/Update) |
| `history/` | history.ts (输入历史 load/append) |
| `logger/` | index, logger, child, cleanup, context, serializers (pino 文件日志, initLogger/closeLogger) |
| `utils/` | asErrorString/strArg/asRecord 等工具函数 |
| `tui/` | 全部 24 文件 (app.tsx 2028 行 — Phase 3 重写; 其余组件原样复用: input.tsx, chat.tsx, ask-user-dialog.tsx, permission-dialog.tsx, plan-approval.tsx, rewind-dialog.tsx, teams-dialog.tsx, team-status.tsx, teammate-*.tsx, provider-select.tsx, status-bar.tsx, tool-display.tsx, diff-render.tsx, scroll-box.tsx, spinner.tsx, mouse.ts, styles.ts, sync-output.ts, verbs.ts, at-expand.ts, is-diff-tool.ts, version.ts) |
| `remote/` | server.ts (1635 行 Koa+WS) + fe/ (浏览器 React/Tailwind 前端子项目) |
| `print-mode.ts` | 非交互 -p 模式 (text / stream-json) |
| `teammate.ts` | --teammate 子进程入口 (文件邮箱轮询) |
| `main.tsx` | 拷入作参考，Phase 3 被 cli/main.ts 替代后**已删除** |

### 2.4 从 swifty 拷贝的测试（31 个，零修改直接通过）

实际执行的拷贝命令：

```bash
cd /Users/hangtiancheng/github/swifty-cli/apps
cp swifty/tests/*.test.ts swifty/tests/run-e2e.mjs swifty/tests/run-failing.mjs larky/tests/
```

拷贝清单：agent, anthropic-context, ask-user, at-expand, code-review, command-loader, compact, config, consolidation, conversation, coordinator, diff, file-mailbox, install-skill, memory, model-resolver, openai-compat, pairing, permissions, plan-file, session, skills, team-file, team-protocol, teams-backend, teams-shared-task, teams, todo, tool-result-wiring, tool-result（.test.ts）+ run-e2e.mjs, run-failing.mjs

零修改即通过的原因：测试使用相对路径导入（`../src/agent/agent.js` 等），拷到 `larky/tests/` 后正好指向拷贝来的 `larky/src/`；vitest 配置也已加了与 swifty 相同的 `@` 别名。

### 2.5 配置文件合并

**package.json**（保留 larky 身份 `@swifty.js/larky` / bin `larky`，并入 swifty 依赖）：
- 新增 dependencies：`@modelcontextprotocol/sdk`, `dompurify`, `js-yaml`, `koa`, `openai`, `react-dom`, `ws`
- 新增 devDependencies：`@swifty.js/glob-addon` (workspace), `@swifty.js/glob-wasm` (workspace), `@tailwindcss/postcss`, `@types/js-yaml`, `@types/koa`, `@types/react-dom`, `@types/ws`, `pino-pretty`, `postcss`, `tailwindcss`
- 新增 scripts：`prebuild`（构建 glob-addon + glob-wasm）、`fe:dev` / `fe:build` / `fe:preview`（remote 前端）
- 修改 scripts：`dev:tui` 从 `tsx ./src/tui/bootstrap.ts` → `tsx ./src/cli/main.ts`
- 保留：`dev`/`dev:core`/`preview`/`doc`/`test`/`typecheck`/publish 系列

**tsconfig.json**：从 larky 的 NodeNext + exactOptionalPropertyTypes 严格配置切换为 swifty 的编译选项 —— `moduleResolution: bundler`、`paths: {"@/*": ["./src/*"]}`（swifty 有 27 个文件使用 `@/` 别名导入）、`jsx: react-jsx`、`exactOptionalPropertyTypes: false`、`noPropertyAccessFromIndexSignature` 关闭等；`include` 加 scripts；`exclude` 增加 `src/remote/fe`（独立子项目自带构建）。

**vitest.config.ts**：增加 `@` 别名 resolve、`environment: "node"`、testTimeout 30s；coverage exclude 增加 `src/remote/fe/**`、`src/**/types.ts`；移除迁移期覆盖率阈值（原 50%）。

**tsup.config.ts**：保持 larky 双 entry 模式并融合 swifty 细节：
- entry 1: `src/cli/main.ts` → `dist/cli/main.js`（shebang + createRequire shim, clean:true）
- entry 2: `src/core/app.ts` → `dist/core/app.js`（无 shebang, clean:false）
- 同时注入 `__LARKY_VERSION__` 与 `__SWIFTY_VERSION__` 两个版本宏（larky 基建读前者，swifty 源码 tui/version.ts 读后者）
- esbuild 插件：externalize node builtins + `react-devtools-core` stub + **externalize `@swifty.js/glob-addon`**（C++ .node 二进制不可打包，取自 swifty 配置）
- onSuccess 资产拷贝：`release.wasm`、`src/skills/builtin/`、`glob_addon.node` → **同时拷到 `dist/cli/` 与 `dist/core/`**（关键点：glob-wasm 通过 `new URL("release.wasm", import.meta.url)` 相对各自 bundle 解析；cli 进程内跑 print/teammate/remote 也需要该资产）

### 2.6 Phase 0 期间的两处小修

- 新建临时 `src/tui/index.tsx`（launchTUI 占位，Phase 3 重写）修复 dev.ts 的 `./tui/index.js` 导入。
- `tests/socket-server.test.ts`：移除对已删 `core/permissions/manager` 的导入，删除依赖它的 B-3 用例。

Phase 0 完成时即达成：typecheck 0 错误、39 个测试文件 259 用例全过。

---

## 三、Phase 1 — Wire Protocol 重写

### 3.1 `src/core/bus/commands.ts`（全部重写，17 个 RPC 方法）

| 方法 | 请求要点 | 响应要点 |
|---|---|---|
| `core.ping` | client | server_version, uptime_ms, received_at |
| `core.status` | — | server_version, uptime_ms, cwd, active_sessions |
| `event.subscribe` | topics[], scope(global / session:<id> / run:<id>), replay_from_run | subscription_id, replayed_count |
| `session.create` | permission_mode?, persist | session_id, cwd, permission_mode, commands[]（供补全） |
| `session.list` | — | sessions[{id, first_message, message_count, mod_time}] |
| `session.resume` | session_id, resume_id | messages[{role, content}]（回放转录） |
| `session.send_message` | session_id, content | run_id（**立即返回**，进度走事件；区别于旧 larky 阻塞到 run 结束） |
| `session.close` | session_id | ok |
| `run.cancel` | session_id | ok, cancelled |
| `permission.respond` | id, response(allow/deny/allowAlways) | ok |
| `ask_user.respond` | id, answers{question→answer} | ok |
| `plan.respond` | id, choice(yolo/manual/feedback), feedback | ok |
| `mode.set` | session_id, mode(default/acceptEdits/plan/bypassPermissions) | ok, mode |
| `command.run` | session_id, input("/xxx args") | accepted（输出走 system.message，command.done 结尾） |
| `command.list` | session_id | commands[{name, description}] |
| `rewind.list` | session_id | snapshots[{index, message_index, user_text, file_count, timestamp}] |
| `rewind.apply` | session_id, index, mode(both/files/conversation) | ok, message |

错误码：-32700..-32603 标准码（保留）+ `SESSION_NOT_FOUND -32010`、`SESSION_BUSY -32012`（保留）+ -32020（无 provider 配置）。

### 3.2 `src/core/bus/events.ts`（全部重写，30 种事件）

- **Agent 流（与 swifty AgentEvent 一一对应）**：`agent.stream_text / agent.thinking_text / agent.thinking_complete / agent.tool_use / agent.tool_result / agent.turn_complete / agent.loop_complete / agent.usage / agent.retry / agent.compact / agent.error`
- **交互请求（带 id，配 `*.respond` RPC）**：`permission.requested / permission.resolved(source: client|timeout|disconnect) / ask_user.requested / ask_user.resolved / plan.requested / plan.resolved`
- **状态推送**：`mode.changed / todo.updated / teammate.state / subagent.progress`
- **命令与系统**：`system.message / command.done / ui.clear / replay.message`
- **生命周期**：`core.started / log.line / session.created / session.closed / run.started`

所有事件带 `timestamp`；会话级事件带 `session_id`；run 级事件带 `run_id`。zod discriminatedUnion，客户端对未知类型静默忽略（前向兼容）。

### 3.3 其他 Phase 1 改动

- `bus/index.ts`：改为 `export * from "./commands.js" / "./events.js"` + envelope 显式导出。
- `transport/ipc-broadcaster.ts`：`handle()` 提取 `session_id`；`_matchesScope` 新增 `session:<id>` 作用域。
- `scripts/gen-protocol-doc.ts`：重写为**遍历 union 自动生成**（RPC_METHODS 表 + `EventSchema.options` 循环提取 literal type），不再手工维护 47 个 section；`pnpm doc` 重新生成 `WIRE_PROTOCOL.md`。

---

## 四、Phase 2 — Daemon 重写

### 4.1 新文件 `src/core/agent-session.ts`（~1300 行，本次核心新代码）

per-session daemon 侧 Handle，融合三个 swifty 来源：`remote/server.ts` 的 `createRemoteAgent`/`AgentHandleImpl`（装配蓝本）、`tui/app.tsx` 的 `initClient`（更完整：InstallSkillTool、SpawnTeammateTool、ListTeamsTool、skill 热重载）、`tui/app.tsx` 的 `runAgentLoop`/`handleSlashCommand`/`handlePlanApproval`。

- **`AgentSession.create()`**：注册 14 个内置工具（ReadFile/Bash/Glob/Grep/Write/Edit/ToolSearch/Enter+ExitWorktree/ExitPlanMode/Task×4）+ ExitPlanMode 的 isPlanMode/planExists 回调 + LoadSkill/InstallSkill（安装后热接线+刷新系统提示）+ AskUserQuestion(→broker) + 7 个 team 工具 + SyntheticOutput + AgentTool（子代理，onProgress → `subagent.progress` 事件）+ MCP 后台连接（工具注册/错误上报/instructions 注入）；系统提示 + skill section；长期记忆注入 + IDENTITY OVERRIDE；hooks 校验 + HookEngine；用户命令加载 + skills→slash 命令接线。
- **`startRun(text, opts)`**：生成 `run-<uuid12>`；运行中则先 cancel（steering 语义，与 swifty TUI 一致）；`expandAtRefs`（从 tui/at-expand.ts 引入，纯函数）@文件展开进对话、原文持久化到 `.swifty/sessions/<swiftyId>.jsonl`；发 `run.started`；后台 `_runLoop`。
- **`_runLoop`**：PermissionChecker(当前 permMode + sandbox 标志)；BashTool 沙箱挂接/摘除（allowWrite/denyWrite/network 配置与 swifty 相同）；MCP instructions 一次性注入；memory recall（非阻塞）；Agent 构造与 swifty `runAgentLoop` 逐项对齐（contextWindow 同步种子+异步升级 / maxOutput / recoveryState / activeSkills / toolFilter=coordinator∧skill / coordinatorActiveFn / notificationFn=teamManager.drainLeads / onLoopComplete=记忆抽取+后台固化 / onPermissionRequest=broker）；`for await` 将 11 种 AgentEvent 桥接为 wire 事件；Task* 工具结果后推 `todo.updated`；catch 区分 abort(→stop_reason "interrupted"+系统提示) 与错误(→`agent.error`)；**finally 必发 `agent.loop_complete`**（客户端状态机依赖）；plan 模式干净结束后进入 `requestPlanApproval`。
- **`requestPlanApproval`**：读 plan 文件 → broker（`plan.requested` 事件 + `plan.respond` RPC）→ yolo(切 bypassPermissions) / manual(还原 prePlanMode) 注入 `buildPlanModeExitReminder` 并 `startRun("Execute this plan:...")`；feedback 直接跑反馈文本。
- **`runCommand`（daemon 侧 slash 执行）**：`/mcp`、`/skill` 简写重写、status/permission/memory 富命令（用 daemon 实时状态：token 计数、工具数、沙箱状态、swiftyId 等）；`local` 类通用执行（CommandContext 提供 permissionMode/tokenCount/toolCount/memoryList/model）；`local_ui` 类逐个实现：clear（重建 conv+重注入 LTM+换 swiftyId+TaskStore+FileHistory+发 `ui.clear`）、plan/do（模式切换+reminder+审批执行）、compact（forceCompact+boundary 持久化）、resume（文本回退路径：`ui.clear` + `replay.message` 流 + 系统提示）、skills（列表 / reload+系统提示刷新）、worktree（git worktree list）、rewind（指引走 RPC）、sandbox（1/2/3 档）；`prompt` 类渲染后 `startRun(prompt, {displayText:"/name args"})`；`skill_fork` 类完整实现（SkillForkHost + runSkillFork，结果以 `agent.stream_text` 回传）——**补齐了 swifty remote 模式 "not yet supported" 的缺口**。
- **`resumeFrom`**（loadSession→rebuildFromSession→重建 conv 含工具块→换 swiftyId/TaskStore/FileHistory→返回可渲染转录）、**`getSnapshots` / `rewind(both|files|conversation)`**、**`setMode`**（进 plan 时记 prePlanMode+发 `mode.changed`）、**`cancel` / `close`**（abort + MCP disconnectAll + `session.closed`）。
- 模块级共享 helper：`wireSkillsToRegistry`、`buildSkillSection`（自 tui/app.tsx 平移）。

### 4.2 重写 `src/core/app.ts`（CoreApp）

- 启动序：larky getConfig + setupLogging → swifty `initLogger({mode:"remote"})`（迁入模块的文件日志）→ TraceWriter（订阅 bus 做事件层 trace）→ **run 事件落盘订阅**（`_persistEvent` → `<workDir>/.swifty/daemon/runs/<runId>/events.jsonl`，取代旧 EventWriter-per-run 布局）→ IpcEventBroadcaster → SocketServer 注册 **17 个 RPC handler** → `core.started` 事件 → teammate 状态 500ms 轮询（JSON 对比变更才推 `teammate.state`）→ SIGINT/SIGTERM 优雅停机（取消 pending 交互、关闭全部 session/MCP、停 server/trace）。
- **InteractionBroker 实现**：三类 pending map（`perm-`/`ask-`/`plan-` 前缀 + uuid8）；respond RPC 幂等（未知/重复 id 静默忽略，先到先得）；resolve 后广播 `*.resolved` 事件让所有客户端同步清除对话框。
- **B-3 断连兜底**：onDisconnect → `broadcaster.unsubscribe` → `subscriptionCount()===0` 时 `_cancelAllInteractions()`（权限 resolve "deny"、ask resolve `{}`、plan reject）。
- swifty 配置懒加载（`_requireSwiftyConfig`），providers 为空报 -32020；`session.create` 用 `providers[0]` + cfg 的 hooks/mcp_servers/sandbox/enable_coordinator_mode/forkEnabled。
- 回放：`snapshotReplayLines(workDir, runId, topics)` / `snapshotReplayLinesFromFile` / `handleEventSubscribe`（B-11 语义原样保留：同步快照→同步订阅→写出快照，可注入 snapshotFn 便于测试）。
- `isDirectRun` 守卫保留（可被测试 import 而不触发 main）。

### 4.3 Phase 2 期间修正

- `AgentSession` 双 id 拆分（脚本化替换）：新增 `swiftyId`；持久化相关（saveMessage / saveCompactBoundary / TaskStore / FileHistory / Agent 的 sessionId / getSessionFilePath / status 展示 / clear / resume）改用 `swiftyId`；wire 事件路由保持稳定 `id`。
- `MCPManager.closeAll()` → 实际方法名 `disconnectAll()`。
- `SwiftyConfig` 类型名 → 实际导出名 `AppConfig`。

### 4.4 架构层测试适配（事件 schema 变更引发）

- `event-bus / event-writer / ipc-broadcaster / socket-server` 四个测试：`run.started` 的 `goal` 字段 → `session_id` + `content`。
- `ipc-broadcaster`：`step.started`（已删除类型）→ `agent.turn_complete`；topic glob 用例 `step.*` → `agent.*`。
- `socket-client`：`session.created` 的 `mode` → `cwd`。

---

## 五、Phase 3 — 客户端改造

### 5.1 重写 `src/tui/app.tsx`（2028 行 → ~800 行 socket 客户端）

**删除**（全部移至 daemon）：`initClient`（~210 行装配）、`runAgentLoop`（Agent 构造+事件消费）、`handleSlashCommand` 的 daemon 侧分支（~560 行）、`handlePlanApproval`/`handleRewindAction` 本地实现、记忆抽取、sandbox 状态、teams 500ms 轮询、conv/session/fileHistory/registry 等全部直接引用。

**保留**（渲染与本地能力，逐段平移）：
- 渲染结构：品牌头（追加 "(connecting…)" 连接状态）、滚动视口（负 marginTop 平移+裁剪、SGR 鼠标滚轮 parseWheel、PageUp/Down、stick-to-bottom）、ChatView / ToolDisplay / Spinner / TeammateSpinnerTree / TeamStatus / 全部对话框组件。
- 流式节流（50ms setTimeout）、turn 折叠为 `turn_summary`（thinking 时长 + 工具汇总；**累加器改为 refs** 因为事件经 handler 到达而非循环闭包）、completionMark（`✻ <verb> for Ns`）。
- 本地能力：输入历史（`.swifty` 目录 load/append）、slash 补全（命令清单来自 `session.create` 返回，包装成 Command stub 供 InputBox；CommandUsageTracker 本地频率排序）、Ctrl+C 双击退出提示、Ctrl+O 展开工具输出、Ctrl+T teams 面板。

**新增**（wire 对接）：
- 连接循环：`connect → event.subscribe(topics:["*"], replay_from_run: lastRunIdRef) → session.create（仅首次，记录 session_id/commands/permission_mode）→ waitForDisconnect → 清瞬态（streaming/activeTools/三类对话框）→ 2s 重连`；事件 handler 只注册一次，经 `handleEventRef` 间接调用避免闭包过期。
- 事件 switch：30 种 wire 事件映射回原渲染逻辑；`run.started` 置 isStreaming（daemon 自发的 run —— 如 plan 审批后的执行 —— 也能正确显示）；`agent.loop_complete` 落定 assistant 消息（interrupted 加 `*[cancelled]*` 后缀）；按 `session_id` 过滤他会话事件；zod safeParse 失败静默跳过（前向兼容）。
- 交互对接：PermissionDialog 改为 **FIFO 队列**（requested 去重入队、resolved/本地应答出队，渲染队首）→ `permission.respond`；AskUserDialog → `ask_user.respond`；PlanApprovalDialog（`plan.requested` 触发）→ `plan.respond`；RewindDialog（`/rewind` → `rewind.list` 构造 Snapshot 形状（backups 用占位键还原 file_count）→ `rewind.apply`，动作映射 code_and_conversation→both / code_only→files / conversation_only→conversation）。
- 提交分流：`/quit|/exit|/q` 本地退出；`/rewind` 本地对话框；其余 `/` 命令 → `command.run`；普通消息 → `session.send_message`（乐观置 streaming，RPC 失败回滚并显示错误）。
- Esc / 运行中 Ctrl+C → `run.cancel`；shift+tab → 乐观 setPermMode + `mode.set`（`mode.changed` 事件最终一致）。

**已知简化**：多 provider 的 ProviderSelect 启动选择移除（daemon 固定 `providers[0]`，头部显示之）；TeamsDialog 的 kill/shutdown 暂为 no-op（需 team 管理 RPC）；`todo.updated` 暂无专属面板。

### 5.2 重写 `src/tui/index.tsx`（launchTUI）

swifty config 加载（校验 providers 非空）+ larky config（host/port）→ `new SocketClient` → alt-screen 进入序列（`\x1b[?1049h\x1b[2J\x1b[H`，**先于** installSyncOutput，并捕获 rawStdoutWrite 供退出还原）→ `initLogger({mode:"tui"})` → `installSyncOutput()` → `render(<App client provider permissionMode/>, {exitOnCtrlC:false})` → waitUntilExit → client.close + `\x1b[?1049l`。

### 5.3 重写 `src/cli/main.ts`

swifty `main.tsx` 的模式分派 + larky 的 daemon 生命周期：
- `--teammate` → `runTeammate`（**进程内**，供 tmux/iterm team 后端 spawn 使用）
- `-p` / print flags → `runPrintMode`（**进程内**一次性运行，与 swifty 行为逐字节一致 —— 对计划的有意偏差：不经 daemon，行为等价且减少风险）
- `--remote [addr]` → RemoteServer（**进程内** Koa+WS，见 Phase 4）
- `--help/-h`、`--version/-V`、`ping`、`version`、`core start|stop|status`、`trace [run_id] [--layer ipc|event|llm] [--direction] [--raw] [--follow]`
- **无参数默认**：`ensureDaemonRunning`（本进程拉起的 daemon 注册 `stopDaemonOnExit` 退出回收）→ 动态 import `launchTUI` → `process.exit(0)`
- 全局钩子：exit→closeLogger、unhandledRejection / uncaughtException 兜底；`isDirectRun` 守卫
- 删除搬运参考用的 `src/main.tsx`

---

## 六、Phase 4 — teams 与 remote

- **teams**：TeamManager 整体驻留 daemon；默认 `in-process` 后端（teammate = daemon 内 spawnSubagent，经文件邮箱通信）；**修复** `teams/team.ts:230` 外部后端入口 —— daemon 进程内 `process.argv[1]` 指向 `core/app.js`（不解析 `--teammate`），正则重写为同级 `cli/main.js`（dev 场景 `core/app.ts` → `cli/main.ts`）。
- **remote**：按计划允许的回退选项执行 —— `remote/server.ts` 原样保留，在 **CLI 进程内**运行完整 agent 栈（`larky --remote`）。TODO：后续可改造为 WS↔daemon RPC 转译层（两侧协议映射基本一一对应）。

---

## 七、Phase 5 — 测试与验证

### 7.1 新写测试（2 个文件 / 9 用例）

- `tests/wire-replay.test.ts`：回放快照 topic glob 过滤与信封形状（`{kind:"event",event}`）、缺失文件返回空、`handleEventSubscribe` 先回放后订阅且 live 事件不丢（B-11）、broadcaster `session:<id>` 作用域过滤。
- `tests/dual-process.test.ts`（真实双进程集成）：spawn `tsx src/core/app.ts`（随机端口、禁 trace）→ core.ping 往返、core.status 零会话、event.subscribe 返回 sub id、未知 session 返回 -32010、**客户端硬断连不打崩 daemon**（7.3 缺陷的回归用例）。LLM 依赖的 RPC 留给手动冒烟以保持 CI 无外部依赖。

### 7.2 验证门禁（最终状态）

| 门禁 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 0 错误 |
| `pnpm build` | ✅ dist/cli/main.js (7.7MB) + dist/core/app.js (2.8MB)，双侧资产齐备 |
| `pnpm test` | ✅ 41 文件 / 268 用例全部通过 |
| `pnpm doc` | ✅ WIRE_PROTOCOL.md 重新生成 |
| daemon 冒烟（端口 5599） | ✅ ping / status / subscribe / session.create（返回 104 个命令） |
| **真实 LLM 端到端** | ✅ `session.send_message "Reply with exactly: OK"` → 事件序列 `session.created → run.started → agent.thinking_text → agent.stream_text("OK") → agent.thinking_complete → agent.usage → agent.loop_complete(end_turn, 3107ms)` |
| CLI 子命令 | ✅ version / --help / core status |
| print 模式 | ✅ `node dist/cli/main.js -p "Reply with exactly: OK"` → `OK` |

### 7.3 迁移中发现并修复的缺陷（架构层遗留 bug）

**daemon 崩溃**：客户端硬断连（socket.destroy → ECONNRESET）时，`socket-server.ts` 的 readline `Interface` 会把底层流错误重发为自身 `error` 事件，未监听导致整个 daemon 进程崩溃（首次冒烟即复现）。修复：补 `rl.on("error")` 走与 close 相同的幂等 cleanup 路径。已由 dual-process 回归用例覆盖。

### 7.4 文档更新

- `README.md`：重写为迁移后架构（特性清单、架构图、pending-map 交互模式说明、用法、开发命令）。
- `RUNBOOK.md`：重写（进程表、生命周期、swifty+larky 双配置体系、磁盘状态表、调试手段、B-3/B-10/B-11/steering 行为说明）。
- `WIRE_PROTOCOL.md`：由 gen-protocol-doc.ts 自动重新生成（勿手改）。

---

## 八、遗留事项 / 后续建议

1. **品牌替换**：代码内 swifty 命名（`.swifty/` 目录、"You are Swifty" 身份提示、`__SWIFTY_VERSION__`、品牌头猫图案）按约定保留，由用户自行全局替换为 larky。
2. **TUI 人工验证**：本迁移环境无 TTY，建议真实终端 `pnpm dev` 走一遍：权限审批对话框、Esc 中断、/compact、/resume、/rewind、plan 模式审批（yolo/manual/feedback）、shift+tab 模式切换、断线重连回放。
3. **remote 模式 daemon 化**：当前进程内运行；可改造为 WS↔daemon 桥接层。
4. **print 模式 daemon 化**（可选）：当前进程内运行，行为与 swifty 等价。
5. **多 provider 选择**：daemon 固定 `providers[0]`；如需运行时切换可加 `provider.set` RPC + 恢复 TUI 选择器。
6. **TeamsDialog kill/shutdown**：需新增 team 管理 RPC（如 `team.stop_member` / `team.send_message`）。
7. **todo.updated 面板**：事件已推送，TUI 暂未渲染专属面板。
8. **lint**：未纳入本次门禁（swifty 拷贝代码与 larky eslint 规则存在风格差异，建议单独一轮清理）。
9. **默认端口 5520 上的旧 daemon**：若机器上仍有旧版 larky-core 运行，先 `larky core stop`（新旧 wire 协议不兼容）。
