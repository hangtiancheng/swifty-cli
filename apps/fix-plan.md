# larky 迁移缺陷修复计划

> 日期：2026-07-26
> 来源：swifty → larky 双进程迁移 review（migrate.md 的后续），4 个并行深度调查确认。
> 范围：`apps/larky`。所有行号基于当前工作区（buildSkillSection 导入错误已修复后的状态）。

---

## 零、总览与 PR 编排

| PR | 内容 | 依赖 | 风险 |
|----|------|------|------|
| PR-1 | P0-1 abortController 守卫（一行） | 无 | 零 |
| PR-2 | P0-2 broker 感知 abortSignal + P0-3 plan 审批可取消 + P1-8b pending 定向清理 | 无 | 低 |
| PR-3 | P0-4 startRun 串行化（_loopDone） | PR-2 | 中 |
| PR-4 | P0-5 客户端 run_id 过滤 | 无（可并行） | 低 |
| PR-5 | P1-6 daemon 重启恢复 + P2-14 退出 close/空闲回收 | 无 | 低 |
| PR-6 | P1-7 skill fork run 生命周期 | PR-2（pending runId） | 低 |
| PR-7 | P1-8a 回放去重（replay_offset + resolved 落盘） | 无 | 低 |
| PR-8 | P1-9 command.run busy 守卫 | 无 | 低 |
| PR-9 | P2 零散项打包（10~17） | 无 | 低 |

wire schema 改动（PR-2/6/7/9）全部为「新增带 default/catch 的字段」，向前向后兼容；改完需重跑 `pnpm doc` 重新生成 WIRE_PROTOCOL.md。

**核心背景结论**（影响多个修复的设计）：
- swifty 单进程的真实 steering 语义是 `submittingRef` **严格串行**——运行中提交被直接丢弃（swifty tui/app.tsx:1641-1647），任何时刻至多一个 loop 写 conv。larky 的 `startRun` 想做「cancel 旧 + 立即起新」，但没有等旧 loop 退出，是 P0 一组问题的总根因。
- broker 三类 pending promise（perm/ask/plan）目前只有两条 settle 路径：客户端 respond、最后一个客户端断连。**abort 与它们完全无关**，abort 后 promise 悬挂。

---

## P0 — 正确性 / 死锁（必须最先修）

### P0-1 `_runLoop` finally 无条件清空 abortController（steering 竞态）

- **位置**：`src/core/agent-session.ts:803`
- **时序**：`startRun` 内 `_runLoop(run-B)` 同步执行到 L574-575 装上 ctrlB；下一个微任务旧 loop(run-A) 的 finally 执行 `this.abortController = null` 清掉 ctrlB → 此后 `run.cancel`/Esc/`close()` 对 run-B 全部失效（`cancel()` L504 见 null 返回 false）。steering 一次必中。
- **修复**（同函数 L562-564 对 currentRunId 已有同款守卫，controller 漏了）：

```diff
     } finally {
-      this.abortController = null;
+      if (this.abortController === controller) {
+        this.abortController = null;
+      }
```

  注意：若同 PR 落 P0-3，这段清理移动到 plan 审批之后（见 P0-3 草案）。
- **测试**：新建 `tests/agent-session-cancel.test.ts`（MockClient 模式参照 tests/agent.test.ts）：startRun→挂起→再 startRun（steering）→ 等旧 loop interrupted → 断言 `s.cancel() === true`。

### P0-2 broker pending 不感知 abort → 旧 loop 悬挂、双 loop 并发写 conv

- **位置**：
  - `src/agent/agent.ts:657-658` `await this.onPermissionRequest(...)` 无 abort 竞速；
  - `src/core/app.ts:141-202` 三个 broker request 方法的 promise 只在 respond/断连时 settle；
  - AskUserQuestion 更糟：executor ctx（agent.ts:617-621）不传 abortSignal，abort 后旧 loop 卡死在 `collectResults`。
- **危害时序**：旧 loop 阻塞在权限对话框时用户输入新消息 → abort 无效、旧 loop 不退出；新消息 `conv.addUserMessage` 把 tool_use/tool_result 配对隔断；用户日后点掉旧对话框 → **已取消的 run 真的执行工具**并把结果插在新 run 消息之后。
- **修复**：InteractionBroker 三个方法加可选 `signal?: AbortSignal`：
  - `agent-session.ts:664-665` onPermissionRequest 传 `controller.signal`；L317 AskUser 注册改传 `s.currentAbortSignal`（新增 getter 返回 `this.abortController?.signal`）；
  - `core/app.ts` broker 实现：每个 pending 用 `settle()` 收敛（以 `map.delete(id)` 返回值做三方竞争互斥：client respond / abort / disconnect），`signal.addEventListener("abort", ...)` 触发时：
    - permission → **resolve("deny")**（agent.ts:659-668 写入 REJECTED_TOOL_RESULT 保住配对，随后 stream 立即以 abort 退出）；
    - ask → **reject**（PendingAsk 加 reject 字段；StreamingExecutor catch 转成 isError tool_result，配对保全）；
    - plan → **reject** + emit `plan.resolved(choice:"cancelled")`；
  - settle 时统一 emit `*.resolved` 事件，`_permissionRespondHandler` 等收敛为只调 pending.resolve，避免双发。
- **schema**：`events.ts:229` `permission.resolved.source` 扩为 `z.enum(["client","timeout","disconnect","abort","run_cancelled","session_closed"]).catch("client")`——用 `.catch()` 而非 `.default()`，让旧客户端对未来新值降级而不是整条 parse 失败丢事件。
- **测试**：建议把 broker 构造抽成可导出的 `createInteractionBroker(deps)` 以便单测。用例：abort → resolve("deny")/reject、pending map 清空、resolved 事件带 source:"abort"；先 respond 再 abort 只 settle 一次。

### P0-3 plan 审批等待期不可取消

- **位置**：`agent-session.ts:816-818`。finally 已把 abortController 清 null，但 `currentRunId` 直到审批结束才清 → 审批期算 running 却不可 cancel（`run.cancel` 返回 cancelled:false）；审批期用户输入新消息会与挂着的审批并存，日后审批被回答又会 cancel 掉用户的新 run；close() 后 pending plan 仍握着已删 session 引用。
- **修复**（依赖 P0-2 的 broker signal）：

```diff
     } finally {
-      this.abortController = null;
       this.emit({ type: "agent.loop_complete", ... });
     }
     if (this.permMode === "plan" && stopReason === "end_turn") {
-      await this.requestPlanApproval();
+      await this.requestPlanApproval(controller.signal);
     }
+    if (this.abortController === controller) {
+      this.abortController = null;
+    }
```

  `requestPlanApproval(signal?)` 把 signal 透传给 broker；catch（L836-838）已能吞掉 reject。
- **行为变化**：审批等待期 Esc 现在会取消审批（plan 文件仍在磁盘，可 `/do` 重新执行）——期望语义，CHANGELOG 注明。
- **测试**：plan 模式 run 结束进入审批 → `s.cancel()` 返回 true、pending plan 清空、收到 `plan.resolved(cancelled)`。

### P0-4 startRun 串行化（等旧 loop 真正退出）

- **位置**：`agent-session.ts:532-567`。
- **修复**：新增 `private loopDone: Promise<void> = Promise.resolve()`，startRun 改为链式排队：

```ts
const prev = this.loopDone;
this.loopDone = (async () => {
  await prev.catch(() => undefined);          // P0-2 保证旧 loop 能很快退出
  if (!opts?.skipUserMessage) {
    this.conv.addUserMessage(expandAtRefs(text, this.workDir)); // 此刻配对已安全
    if (this.persist) sessionMod.saveMessage(...);
  }
  if (this.currentRunId !== runId) return;    // 排队期间又被新 steering 取代
  await this._runLoop(runId);
})().finally(() => {
  if (this.currentRunId === runId) this.currentRunId = null;
});
```

  关键点：**新用户消息入 conv 推迟到旧 loop 排干之后**，保证 `assistant(tool_use) → tool_result → user(新消息)` 顺序。`run.started` 仍同步 emit（客户端立即响应）。递归安全：requestPlanApproval 内部 startRun 不形成环等待（已验证）。
- **风险**：旧 loop 卡在不感知 abort 的普通工具（如 Bash sleep）时新 run 要排队。后续项（可选，不捆绑）：agent.ts:617-621 executor ctx 传 `abortSignal`，BashTool abort 时 kill 子进程。
- **测试**：MockClient 第一轮 tool_call 触发权限 ask，假 broker 挂起到 abort；startRun("one")→permission.requested→startRun("two")→断言 (a) loop_complete(run1) 先于 run2 全部 agent.* 事件；(b) conv 顺序 `[..., assistant(toolUses), toolResults(rejected), user("two")]`；(c) pending 归零。

### P0-5 客户端不按 run_id 过滤，旧 run 迟到事件错杀新 run

- **位置**：`src/tui/app.tsx:242-247`（只有 session 过滤）、L361-386（loop_complete 无条件落定）。
- **危害**：steering 后旧 run 的 `loop_complete(interrupted)` 必然晚于新 `run.started` 到达 → 新 run 的部分文本被带 `*[cancelled]*` 提前提交、isStreaming 置 false、Esc/Ctrl+C 取消失效、新 run 流式文本不再渲染。**即使 daemon 全修好这条也必须修**（时序上旧事件天然迟到）。
- **修复**：session 过滤后追加（建议抽成 `src/tui/run-filter.ts` 纯函数 `isStaleRunEvent(event, currentRunId)`）：

```ts
if (
  event.type.startsWith("agent.") &&
  "run_id" in event && event.run_id !== "" &&   // ""（skill fork）豁免
  lastRunIdRef.current !== null &&
  event.run_id !== lastRunIdRef.current
) return;
```

  覆盖 `agent.stream_text/thinking_text/thinking_complete/tool_use/tool_result/turn_complete/loop_complete/usage/retry/compact/error`；不过滤 `run.started`（lastRunIdRef 更新源）与 `permission.requested`/`ask_user.requested`。
- **测试**：`tests/run-filter.test.ts` 纯函数单测：旧 run 事件 drop、run_id="" keep、run.started keep、current 为 null keep、非 agent 事件 keep。

---

## P1 — 可用性

### P1-6 daemon 重启后客户端永久失效

- **位置**：`tui/app.tsx:539`（仅 `!sessionIdRef.current` 时 create；545 行后 ref 永不清空）；daemon session 仅存内存（core/app.ts:109），重启后旧 id 必 -32010；现有 catch（app.tsx:672-679、216-223）只显示错误无恢复；`session.closed` 客户端根本没有 case（落 default 忽略），崩溃场景更是什么都不发。
- **修复**（方案 a：探活 + 兜底，零协议改动）：
  1. 重连循环在 `event.subscribe` **之前**探活：`sessionIdRef.current` 非空时调 `command.list`（现成无副作用 RPC）；捕获 `IpcError.code === -32010` → 清 `sessionIdRef` + `lastRunIdRef = null`（禁止死 session 的陈旧回放）+ pushSystem 提示「daemon 已重启，会话已重置——转录保留，上下文丢失」；
  2. subscribe 的 `replay_from_run` 只在 session 有效时携带；
  3. 兜底：handleSubmit / rpc() 的 catch 识别 -32010 → 清 ref，handleSubmit 一次性重建 session 后重发（防死循环只重试一次）。`IpcError` 已从 socket-client.ts export。
- **测试**：双进程测试：create → kill daemon → 同端口重启 → 断言自动重建 session（新 id ≠ 旧 id）且 send_message 成功。

### P1-7 skill fork 输出被吞

- **位置**：`agent-session.ts:1396-1405`（`agent.stream_text` run_id:"" 无 run 包裹）；客户端只在 isStreaming 渲染、只在 loop_complete 落定。
- **修复**（方案 b2，合成完整 run 生命周期，渲染为 assistant 消息与 swifty 语义一致，且带 run_id 可落盘可回放）：
  `run.started(content:"/name args")` → `runSkillFork` → `agent.stream_text(runId)` → finally `agent.loop_complete(end_turn|error)` + `commandDone()`；期间设置 `currentRunId = runId`（让 pending 带上 run_id，且 busy 守卫可见），finally 中 `if (this.currentRunId === runId) this.currentRunId = null`。
- **风险**：fork 无 abortController，`run.cancel` 期间返回 cancelled:false——与现状一致不回退。
- **测试**：mock runSkillFork，断言 emit 序列与失败路径 stop_reason=error；wire-replay 断言 fork 事件被持久化。

### P1-8 重连回放重复 + 幽灵对话框

**8a 回放去重**：
- **位置**：客户端每次重连带 `replay_from_run`（tui/app.tsx:534-538），`lastRunIdRef` run 结束后不清空 → 完结 run 也整场重放；daemon 整文件回放（core/app.ts:676-741）；handleEvent 无幂等 → turn_summary/assistant 消息重复 append、usage 翻倍。
- **修复**：
  1. 速效：`agent.loop_complete` 处理尾部 `lastRunIdRef.current = null`——run 已结束不需要任何回放（消掉最常见重复场景）；
  2. 游标：`EventSubscribeCommandSchema` 加 `replay_offset: z.number().int().nonnegative().default(0)`；`snapshotReplayLines` 跳过前 offset 条匹配行；客户端 `replayedCountRef` 在 run.started 置 0、此后每收一条当前 run 事件 +1，重订阅时携带。两端计数口径一致（都是「带非空 run_id 的事件」）。
- **测试**：扩展 tests/wire-replay.test.ts：offset=2 只回放 1 行；offset 超总数回放 0。

**8b resolved 事件落盘 + 定向清理**：
- **位置**：`permission.resolved`/`ask_user.resolved` schema 无 run_id（events.ts:224-232、244-250），`_persistEvent`（core/app.ts:125-137）不落盘 → 回放重现已解决对话框（对话框存在时 InputBox disabled，阻塞输入）。另 `plan.requested` 本身无 run_id 不回放（断连期间 plan 请求无法补投，顺带修）。
- **修复**：
  1. Pending 三结构（app.ts:86-100）加 `runId: string`（`session.currentRunId ?? ""`）；
  2. `permission.resolved`/`ask_user.resolved`/`plan.requested`/`plan.resolved` schema 加 `run_id: z.string().default("")`，emit 时带上 → 自动落盘，回放顺序 requested→resolved 天然清对话框；
  3. 定向清理（P0-2 的 abort 监听已覆盖 run 级；这里补 handler 级）：`cancelPendingForSession(sessionId)` 在 `_sessionCloseHandler`（app.ts:359-368）调用；permission resolve("deny")、ask resolve({})、plan reject，emit resolved（source "session_closed"）。
- **测试**：respond 后读 events.jsonl 断言 resolved 落盘且 run_id 正确；回放喂 requested→resolved 断言对话框清空。

### P1-9 command.run 无 busy 守卫

- **位置**：`core/app.ts:445-457` 直接 `void session.runCommand`；run 进行中 `/compact` 并发 forceCompact 同一 conv、`/clear` 与带参 `/resume` 中途替换 conv/larkyId（在跑 Agent 写串会话文件）。`session.resume` RPC 有 SESSION_BUSY 守卫（app.ts:338-340），command.run 没有。
- **分类**：
  - **busy 拒绝**：`compact`、`clear`、带参 `resume`、`do`、skill_fork 类；
  - **允许**：只读类（status/help/session/memory/permission/mcp/skills/worktree/rewind/sandbox/无参 resume）；
  - **允许（steering 语义）**：prompt 类（走 startRun）、`plan`（等价 shift+tab，swifty 允许运行中切模式）。
- **修复**：daemon 侧 `runCommand` 入口守卫（local_ui handler 是纯函数返回 action 字符串，可安全预调用判断）；被拒时 `system.message`（"/xxx is not available while a run is in progress. Press Esc to interrupt first."）+ `command.done`。可选：RPC 级抛 SESSION_BUSY（客户端 rpc() catch 已会 pushSystem）。
- **测试**：置 currentRunId 模拟在跑 → `/compact` `/clear` `/resume abc` 收到拒绝提示且 conv/larkyId 未变；`/status`、无参 `/resume` 正常。

---

## P2 — 对齐与体验（可打包一个 PR）

### P2-10 `LARKY_BYPASS_PERMISSIONS=1` 完全无效【必修】
- `tui/app.tsx:156-164` 只设 UI 初值，且 550-553 行被 daemon 返回值覆盖回去。swifty 的 `SWIFTY_BYPASS_PERMISSIONS` 是真实权限模式。
- 修复：`session.create` 处（app.tsx:540-543）`permission_mode: process.env.LARKY_BYPASS_PERMISSIONS === "1" ? "bypassPermissions" : ...`。

### P2-11 `skills/catalog.ts:322` `.swifty/skills` 残留【必修，一行】
- 系统提示指示模型把新 skill 建到 `.swifty/skills`（不被扫描，创建即失效）。改为 `.larky`。全仓唯一残留。

### P2-12 `_lastTeammateStates` 全局单值 → 多会话事件风暴【必修】
- `core/app.ts:116、515-533`。改 `Map<sessionId, string>`；`_sessionCloseHandler` 中 `delete`。

### P2-13 daemon 自发 run 的触发文本不上屏【必修】
- `run.started.content`（events.ts:85-92）被客户端忽略（tui/app.tsx:250-259）→ plan 审批后的 "Execute this plan:…"、feedback 文本不可见。
- 修复：`lastSubmittedTextRef` 记录本地刚提交的文本；`run.started` 时 `content` 非空且 ≠ lastSubmittedText 才 push user 消息（防双显），然后清 ref。

### P2-14 TUI 退出不 close session + daemon 无空闲回收
- `tui/index.tsx:59-61` 只断 TCP；常驻 daemon 场景每开一次 TUI 泄漏一个 AgentSession（含 MCP 连接、teammate 轮询遍历）。
- 修复：App 加 `onSessionChange` prop 上报 id；`waitUntilExit` 后 `session.close`（`Promise.race` 1s 超时保护）再 `client.close()`。
- 兜底（防 kill -9）：`onDisconnect` 中 `subscriptionCount()===0` 时启动 idle timer（默认 30min），到期 close 所有 `!isRunning` 且无 pending 交互的 session；新订阅清 timer。

### P2-15 plan 审批触发条件对齐
- `agent-session.ts:816` 只在 `end_turn` 弹；swifty 是「任何非 error 的 loop_complete 都弹」（interrupted 也弹，error 不弹）。改为 `stopReason !== "error"`。

### P2-16 命令别名丢失
- `CommandInfoSchema`（commands.ts:42-46）、`listCommands()`（agent-session.ts:982-987）、客户端 stub（tui/app.tsx:66-70、118-126）三处补 `aliases`（`.default([])` 兼容）。input.tsx 补全逻辑本来就支持 aliases。

### P2-17 其余小项
- **resumeFrom 刷新 LTM**（agent-session.ts:922-923）：resume 时重新 `loadInstructions` + `buildSystemReminder`（对齐 swifty），而非复用 create() 快照。
- **prompt 命令持久化对齐**（agent-session.ts:1113-1120）：持久化展开后的 promptText 而非 displayText（否则 /resume 后模型看到 `/review foo` 字面量）；且不再对渲染后 prompt 二次 expandAtRefs。`/do`（1192-1196）对齐 swifty：不持久化、不展开。注意与 P0-4 的 startRun 改动同区域，按 PR 顺序合并。
- **runs 目录清理**：新增 `cleanExpiredRunDirs`（7 天 + 保留最近 20 个双条件 AND），daemon 启动 `server.start()` 后 fire-and-forget；参照 logger/cleanup.ts 模式但需 recursive rm 目录。
- **argv 防御**（core/app.ts:749）：`const entry = process.argv[1] ?? ""`。

### 明确不修
- `thinking_complete` 丢 signature：signature 只在 daemon 内部 LLM 回传链路使用（conversation→anthropic/openai），wire 层是纯展示事件，TUI 无消费方。

---

## 验证门禁

每个 PR 合入前：`pnpm typecheck` && `pnpm build` && `pnpm test` 全绿（**注意不要用管道接 tail 查看，会掩盖退出码**——本次 review 即因此差点漏掉启动崩溃）。全部完成后：
1. 双进程集成测试扩展（重启恢复、cancel 链路、busy 守卫、回放 offset）；
2. 真实终端 `pnpm dev` 人工走查：steering（运行中连发消息 + Esc）、权限对话框弹出时 Esc、plan 审批期 Esc、断线重连（kill daemon 重启）、/compact 运行中被拒、fork skill 输出显示、多开 TUI 无 teammate 事件风暴；
3. `pnpm doc` 重新生成 WIRE_PROTOCOL.md。
