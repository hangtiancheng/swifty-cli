# SwiftyCode TUI 对齐 Swifty 实施规格

> 目标：将 `apps/swifty-code/src/tui/` 的 UI 风格、视觉效果彻底重写，对齐 `apps/swifty/src/tui/`（Swifty），仅保留暖琥珀色板。
> 约束：只允许修改 `tui/` 和 `cli/` 目录。不改 `core/`。
> 保留：SwiftyCode 额外能力（context_percent 进度条、daemon 连接状态、事件重放）。

---

## 范围边界

### 可实现（不依赖 core）

1. **样式系统重写**：chalk 函数式风格，COLORS/ICONS/BORDER_COLORS 三套常量（琥珀色板）
2. **性能优化**：AlternateScreen（1049）+ SynchronizedOutput（DEC 2026）+ 流式节流（50ms）+ 增量 Markdown（前缀缓存）+ React.memo
3. **Static / 动态分离**：committedIndexRef 切分已提交消息与活跃消息，消除历史闪烁
4. **InputBox 彻底重写**：多行编辑（lines[] + cursorLine/cursorCol）+ 5 层斜杠补全 + fuse.js 模糊 + ghost text + @文件提及补全（仅 UI）+ 历史导航 + Shift+Tab 权限模式切换（本地状态）
5. **消息系统**：7 种 ChatMessage role，MessageBlock 多态渲染，StreamingText 增量 markdown
6. **Spinner**：ink-spinner + 趣味动词池 + token/elapsed 统计
7. **对话框体系**：PermissionDialog（3 选项，Swifty 风格）+ Ctrl+C 双击退出
8. **CLI 调整**：启动时安装 sync output，Ctrl+C 优雅关闭

### 不实现（依赖 core）

- **turn_summary 折叠**：需要识别 turn 边界，core 的 step 事件不等于 turn 边界，保留逐事件展示
- **Plan Mode / PlanApprovalDialog**：依赖 core 的 plan 文件与 ExitPlanMode 工具
- **RewindDialog**：依赖 core 的 FileHistory 快照
- **TeamsDialog / TeammateSpinnerTree**：依赖 core 的 TeamManager
- **AskUserDialog**：依赖 core 的 AskUserQuestion 工具
- **记忆召回/提取**：依赖 core 的 MemoryManager/MemoryExtractor
- **Skills 热重载**：依赖 core 的 SkillCatalog（但斜杠命令补全用 TUI 侧 SkillLoader.listAllSkills() 可实现）
- **@文件提及内联到对话**：expandAtRefs 需要注入到发送给 daemon 的消息，但 session.send_message 的 content 是纯文本，可附加但不改 core 的处理。决定：仅在 UI 补全文件路径，不内联文件内容到消息（避免 daemon 端无法处理）
- **ProviderSelect**：SwiftyCode 的 provider 由 daemon 配置，TUI 无需选择
- **本地命令系统**（/clear /status /resume /skills /rewind /sandbox 等）：多数依赖 core 功能。仅 /compact 已有（daemon 支持 session.compact）

---

## 依赖变更

`apps/swifty-code/package.json` 新增 dependencies：

- `chalk@^5.3.0`（ESM，Swifty styles.ts 依赖）
- `fuse.js@^7.0.0`（斜杠命令模糊匹配）

`apps/swifty-code/src/tui/` 新增文件清单（对齐 Swifty 结构）：

```
tui/
├── app.tsx              (重写)
├── bootstrap.ts         (重写：安装 sync output + alt screen)
├── index.ts             (重写：render 配置)
├── theme.ts             (保留琥珀色板，重构为 chalk 函数式)
├── styles.ts            (新增：COLORS/ICONS/BORDER_COLORS，对齐 Swifty)
├── alternate-screen.tsx (新增)
├── sync-output.ts       (新增)
├── spinner.tsx          (新增)
├── verbs.ts             (新增)
├── chat.tsx             (新增：ChatView + StreamingText + MessageBlock)
├── input.tsx            (新增：多行 InputBox)
├── tool-display.tsx     (新增：ToolBlock 实时块)
├── diff-render.tsx      (新增：DiffLines 着色)
├── is-diff-tool.ts      (新增)
├── scroll-box.tsx       (新增：占位)
├── at-expand.ts         (新增：@文件提及 UI 补全用，不内联)
├── permission-dialog.tsx(新增：替换 PermissionPrompt)
├── components/          (删除整个目录，逻辑迁移到新文件)
└── ...
```

删除文件：

- `tui/components/` 整个目录（header.tsx / input-bar.tsx / status-bar.tsx / event-card.tsx / event-log.tsx / permission-prompt.tsx / slash-complete-popup.tsx / tool-use-card.tsx）

---

## 详细实施步骤

### 第 1 步：新增样式系统

**文件**：`tui/styles.ts`（新建）

对齐 Swifty 的 `apps/swifty/src/tui/styles.ts`，但主色改为暖琥珀：

```ts
import chalk from "chalk";

export const COLORS = {
  primary: chalk.hex("#d4a017"), // 琥珀（替代 Swifty 的 #42b883 绿）
  white: chalk.bold.white,
  dim: chalk.dim,
  black: chalk.black,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.bold.red,
  muted: chalk.gray,
  thinking: chalk.hex("#d4a017ee"), // 琥珀带透明
  tool: chalk.cyan,
  user: chalk.bold.blue,
  assistant: chalk.bold.hex("#d4a017"), // 琥珀
} as const;

export const ICONS = {
  prompt: ">",
  thinking: "✻",
  tool: "⏺",
  success: "✓",
  error: "✗",
  arrow: "→",
  dot: "·",
} as const;

export const BORDER_COLORS = {
  idle: "gray",
  focused: "#d4a017", // 琥珀（替代 Swifty 的 #a78bfa 紫）
  agent: "#fbbf24", // amber-400
  error: "red",
} as const;
```

**文件**：`tui/theme.ts`（重构）

保留琥珀色板与工具函数（formatDuration/truncate/contextBarFill/contextBarColor/formatTimestamp），移除 `indicator` 子对象（改用 ICONS），移除 hex 字符串色（改用 COLORS chalk 函数）。

### 第 2 步：性能优化基础设施

**文件**：`tui/sync-output.ts`（新建，从 Swifty 移植）

完整复制 `apps/swifty/src/tui/sync-output.ts`（102 行），检测 DEC 2026 支持 + monkey-patch `process.stdout.write`，microtask 合并帧。

**文件**：`tui/alternate-screen.tsx`（新建，从 Swifty 移植）

完整复制 `apps/swifty/src/tui/alternate-screen.tsx`（40 行）：

- 进入时 `\x1b[?1049h\x1b[H\x1b[2J`
- 设置 `globalThis.__swifty_alt_screen__ = true`
- 监听 resize
- 退出时 `\x1b[?1049l`

**文件**：`tui/bootstrap.ts`（重写）

```ts
import { installSyncOutput } from "./sync-output.js";
import { launchTUI } from "./index.js";

installSyncOutput(); // 在 render 前安装
void launchTUI();
```

**文件**：`tui/index.ts`（重写）

```ts
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { AlternateScreen } from "./alternate-screen.js";
import { getConfig } from "../core/config.js";
import { SocketClient } from "../core/transport/socket-client.js";

export async function launchTUI(): Promise<void> {
  const config = getConfig();
  const client = new SocketClient(config.host, config.port);
  const instance = render(
    <AlternateScreen>
      <App _config={config} client={client} />
    </AlternateScreen>,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
}
```

### 第 3 步：Spinner + 动词池

**文件**：`tui/verbs.ts`（新建）

从 Swifty 移植 `apps/swifty/src/tui/verbs.ts`（135 行）：

- `spinnerVerbs`（100+ 进行时动词）
- `completionVerbs`（19 完成时动词）
- `randomVerb()` / `randomCompletionVerb()`

**文件**：`tui/spinner.tsx`（新建）

从 Swifty 移植 `apps/swifty/src/tui/spinner.tsx`（62 行）：

- ink-spinner dots 动画
- `verbRef` 随机动词
- `setInterval(1000)` 计时
- input/output token 统计
- `React.memo` 包装

### 第 4 步：ChatView + StreamingText + MessageBlock

**文件**：`tui/chat.tsx`（新建，对齐 Swifty 的 chat.tsx）

从 Swifty 的 `apps/swifty/src/tui/chat.tsx`（394 行）移植，适配 daemon 事件模型：

关键结构：

```ts
export interface ToolSummaryItem {
  toolName: string;
  argsSummary: string;
  output: string;
  isError: boolean;
  elapsed: number;
}

export interface ChatMessage {
  role:
    | "user"
    | "assistant"
    | "system"
    | "thinking"
    | "tool_use"
    | "tool_result";
  content: string;
  toolName?: string;
  argsSummary?: string;
  isError?: boolean;
  elapsed?: number;
}
```

注意：**无 `turn_summary` role**（不实现折叠）。

组件：

- `renderMarkdown(text)`：marked + markedTerminal，chalk.level=3
- `StreamingText`：增量渲染 + 前缀缓存 + countPhysicalLines 截断
- `ChatView`：活跃消息 + streamingText
- `CommittedMessage`：Static 内的已提交消息包装
- `MessageBlock`：switch(role) 分发（user/assistant/system/thinking/tool_use/tool_result）

与 Swifty 的差异：事件来源是 daemon 而非本地 agent.run()，事件类型映射在 app.tsx 中完成（见第 7 步）。

### 第 5 步：ToolDisplay + DiffLines

**文件**：`tui/is-diff-tool.ts`（新建，5 行）

```ts
export function isDiffTool(toolName: string): boolean {
  return toolName === "WriteFile" || toolName === "EditFile";
}
```

注意：SwiftyCode 的 WriteFile 输出也可能是 diff 格式，这里比 Swifty 多包含 WriteFile。

**文件**：`tui/diff-render.tsx`（新建，从 Swifty 移植）

完整复制 `apps/swifty/src/tui/diff-render.tsx`（35 行）：`+ ` 绿、`- ` 红、其他 dim。

**文件**：`tui/tool-display.tsx`（新建，对齐 Swifty）

从 Swifty 的 `apps/swifty/src/tui/tool-display.tsx`（95 行）移植：

- `ToolBlockInfo`：含 `loading` 标志
- `ToolBlock`：loading 显示 `●` magenta + 工具名
- 完成显示 `✓`/`✗` + 工具名 + 参数摘要 + 耗时 + 输出（>500 截断）
- `formatArgs`：优先 command/file_path/pattern

### 第 6 步：InputBox 彻底重写

**文件**：`tui/input.tsx`（新建，对齐 Swifty 的 575 行 InputBox）

从 Swifty 的 `apps/swifty/src/tui/input.tsx` 移植，适配 SwiftyCode：

**保留 Swifty 功能**：

- `lines: string[]` 多行模型 + cursorLine/cursorCol
- `<Text inverse>` 光标反显
- Shift+Enter / Ctrl+J 换行
- Ctrl+A/E 行首尾
- ↑↓ 多行跨行移动 + 单行历史导航
- Backspace 行首合并上行
- Tab 斜杠补全 / @文件补全
- Shift+Tab 权限模式循环（default→acceptEdits→plan→bypassPermissions）
- Ghost text 幽灵提示
- `scanWorkdirFiles`（跳过 .开头和 SKIP_DIRS，max 2000）

**斜杠命令补全 5 层匹配**：

```ts
// Tier 1: 精确名匹配
// Tier 2: 精确别名匹配
// Tier 3: 前缀名匹配
// Tier 4: 前缀别名匹配
// Tier 5: fuse.js 模糊匹配（name:3, aliases:2, description:0.5, threshold:0.4）
```

命令源：`/compact` 内置 + `SkillLoader.listAllSkills()`（core 的 loader，只读不写，允许）。

**@文件提及补全**：

- 正则 `(?:^|\s)@([^\s]*)$` 检测行尾 @token
- `fileCacheRef` 缓存 scanWorkdirFiles 结果
- 前缀匹配优先 + 子串匹配，取前 8 个
- Tab/Enter 补全：替换 `@partial` → `@path `
- **不内联文件内容到消息**（daemon 端不支持 expandAtRefs 处理）

**历史导航**：

- `history: string[]` prop 由 app.tsx 传入，本地用 `~/.swifty/tui-history.json` 存储
- ↑ 切换更早的历史，↓ 切换更新的历史
- 多行历史条目按 `\n` split 还原

**权限模式切换**：

- `MODEL_CYCLE: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"]`
- `MODEL_DISPLAY`：default=gray, acceptEdits=green, plan=yellow, bypassPermissions=red
- Shift+Tab 循环，显示在输入框下方
- 注意：这是**纯 UI 状态**，不发送到 daemon（daemon 侧权限由 permission.respond 决定）

**输入框边框**：`borderStyle="round"` + BORDER_COLORS 按状态变色（替代当前 single border）。

### 第 7 步：App.tsx 彻底重写

**文件**：`tui/app.tsx`（重写，对齐 Swifty 的渲染结构）

保留 SwiftyCode 的 daemon 连接逻辑 + 事件监听，重写渲染层：

**保留 SwiftyCode 的 daemon 逻辑**：

- `client.onEvent` 事件回调注册（一次，跨重连）
- 连接循环（connect → subscribe → create session → waitForDisconnect → retry 2s）
- `handleSubmit`：/compact 处理 + session.send_message
- `handlePermissionRespond`：permission.respond
- Ctrl+C 优雅关闭（session.close → exit）

**新增 Swifty 风格的渲染结构**：

```tsx
<Box flexDirection="column" width="100%" height="100%">
  {/* 已提交消息：Static */}
  <Static items={messages.slice(0, committedIndexRef.current).map(...)}>
    {(item) => <CommittedMessage ... />}
  </Static>

  {/* 活跃内容：streaming + 新消息 */}
  <ChatView messages={messages.slice(committedIndexRef.current)} streamingText={...} />

  {/* 工具实时块 */}
  {activeTools.length > 0 && <ToolDisplay tools={activeTools} />}

  {/* Spinner */}
  {isRunning && <Spinner inputTokens={totalTokens} outputTokens={outputTokens} />}

  {/* Context 进度条（SwiftyCode 独有，保留） */}
  <ContextBar percent={contextPercent} />

  {/* 权限对话框 */}
  {permissionRequest && <PermissionDialog ... />}

  {/* 输入框 */}
  <InputBox onSubmit={handleSubmit} disabled={...} history={promptHistory} ... />
</Box>
```

**事件 → ChatMessage 映射**（在 onEvent 回调中）：

| daemon 事件                 | ChatMessage 产出                                    |
| --------------------------- | --------------------------------------------------- |
| `session.message_received`  | `{role:"user", content}`                            |
| `llm.token` / `llm.text`    | 累加到 `streamingTextRef`，50ms 节流                |
| `tool.call_started`         | push 到 `activeTools`（loading=true）               |
| `tool.call_finished`        | 更新 activeTools + push `{role:"tool_result", ...}` |
| `tool.call_failed`          | 同上 + isError                                      |
| `session.waiting_for_input` | flush stream → committedIndex 推进                  |
| `llm.usage`                 | 更新 token 计数                                     |
| `run.started`               | 清空累加器                                          |
| `run.finished`              | flush stream → committedIndex 推进                  |
| `permission.requested`      | 弹 PermissionDialog                                 |
| `permission.granted/denied` | 系统消息                                            |

**committedIndexRef 推进时机**：

- `run.finished`：把 streamingText 落盘为 assistant 消息，推进 committedIndex
- `session.waiting_for_input`：同上

**流式节流**：

```ts
streamThrottleRef.current ??= setTimeout(() => {
  setStreamingText(streamingTextRef.current);
  streamThrottleRef.current = null;
}, 50);
```

**ContextBar 子组件**（SwiftyCode 独有，保留）：

```tsx
function ContextBar({ percent }: { percent: number }) {
  if (percent <= 0) return null;
  const bar = contextBarFill(percent); // "████████░░░░░░░░░░░░"
  const color = contextBarColor(percent); // ≥85% red, ≥70% yellow, else muted
  return (
    <Box paddingLeft={1}>
      <Text dimColor>context </Text>
      <Text color={color} bold={percent >= 0.85}>
        {bar}
      </Text>
      <Text dimColor> {(percent * 100).toFixed(1)}%</Text>
    </Box>
  );
}
```

**Ctrl+C 双击退出**（对齐 Swifty）：

```ts
useInput((input, key) => {
  if (key.ctrl && input === "c") {
    if (isRunning) {
      // daemon 架构无法中断 daemon 侧运行，仅禁用输入
      setCtrlCHint(true);
      setTimeout(() => setCtrlCHint(false), 2000);
      return;
    }
    ctrlCCountRef.current += 1;
    if (ctrlCCountRef.current >= 2) {
      // 优雅关闭
      void closeAndExit();
      return;
    }
    setCtrlCHint(true);
    setTimeout(() => {
      ctrlCCountRef.current = 0;
      setCtrlCHint(false);
    }, 2000);
  }
});
```

注意：daemon 架构下 Ctrl+C 无法中断 daemon 侧正在运行的 agent，只能等 daemon 完成。双击退出会先 session.close 再 exit。

### 第 8 步：PermissionDialog（Swifty 风格）

**文件**：`tui/permission-dialog.tsx`（新建，对齐 Swifty）

从 Swifty 的 `apps/swifty/src/tui/permission-dialog.tsx`（63 行）移植，但保留 SwiftyCode 的 4 选项（allow_once / always_allow / deny_once / always_deny，因为 daemon 的 PermissionManager 支持这 4 种 decision）：

```tsx
const PERMISSION_OPTIONS = [
  { label: "Yes", action: "allow_once" },
  {
    label: "Yes, and don't ask again for this pattern",
    action: "always_allow",
  },
  { label: "No", action: "deny_once" },
  { label: "No, and always deny this pattern", action: "always_deny" },
];
```

- ↑↓ 导航，Enter 确认，Esc 默认 deny_once
- Swifty 风格视觉：`> ` 提示符 + cyan 高亮选中项

### 第 9 步：CLI 调整

**文件**：`cli/main.ts`（微调）

无需大改。`tui` 子命令已调用 `launchTUI()`。仅确保 `chat` 命令的 ChatPrinter 保持不变（不在本次重写范围）。

可选：将 `tui` 命令描述从 "Launch the terminal UI" 改为更友好的提示。

### 第 10 步：删除旧组件目录

删除 `tui/components/` 整个目录：

- `header.tsx`（功能合并到 app.tsx 顶部 banner）
- `input-bar.tsx`（被 input.tsx 替代）
- `status-bar.tsx`（功能合并到 app.tsx 底部 + ContextBar）
- `event-card.tsx`（逻辑迁移到 chat.tsx 的 MessageBlock + 事件映射）
- `event-log.tsx`（被 Static + ChatView 替代）
- `permission-prompt.tsx`（被 permission-dialog.tsx 替代）
- `slash-complete-popup.tsx`（功能合并到 input.tsx 的下拉补全）
- `tool-use-card.tsx`（被 tool-display.tsx 替代）

---

## 验证清单

每个步骤完成后验证：

1. `cd apps/swifty-code && pnpm typecheck` — 类型检查通过
2. `cd apps/swifty-code && pnpm lint` — ESLint 通过
3. `pnpm dev:tui` — TUI 启动无崩溃（需先 `pnpm dev:core` 启动 daemon）
4. 手动测试：
   - 启动 banner 显示（Swifty 风格猫咪 banner + 琥珀色）
   - 输入消息，观察流式 markdown 渲染无闪烁
   - 斜杠命令补全 5 层匹配生效
   - @文件提及补全生效
   - 多行编辑（Shift+Enter 换行）
   - Ctrl+C 双击退出
   - 权限弹窗 4 选项 + Esc 默认 deny
   - context 进度条显示
   - Alternate Screen 进出正常（退出后终端恢复正常）

---

## 文件变更总览

| 操作 | 文件                        | 行数预估                                               |
| ---- | --------------------------- | ------------------------------------------------------ |
| 新建 | `tui/styles.ts`             | ~45                                                    |
| 重构 | `tui/theme.ts`              | ~60（保留工具函数，移除 indicator）                    |
| 新建 | `tui/sync-output.ts`        | ~102                                                   |
| 新建 | `tui/alternate-screen.tsx`  | ~40                                                    |
| 重写 | `tui/bootstrap.ts`          | ~8                                                     |
| 重写 | `tui/index.ts`              | ~30                                                    |
| 新建 | `tui/verbs.ts`              | ~135                                                   |
| 新建 | `tui/spinner.tsx`           | ~62                                                    |
| 新建 | `tui/chat.tsx`              | ~350（无 turn_summary，比 Swifty 少）                  |
| 新建 | `tui/input.tsx`             | ~575                                                   |
| 新建 | `tui/tool-display.tsx`      | ~95                                                    |
| 新建 | `tui/diff-render.tsx`       | ~35                                                    |
| 新建 | `tui/is-diff-tool.ts`       | ~5                                                     |
| 新建 | `tui/scroll-box.tsx`        | ~35                                                    |
| 新建 | `tui/at-expand.ts`          | ~40（仅 UI 补全用）                                    |
| 新建 | `tui/permission-dialog.tsx` | ~70                                                    |
| 重写 | `tui/app.tsx`               | ~600（比 Swifty 1855 少，无 Plan/Rewind/Teams/Memory） |
| 修改 | `package.json`              | +2 deps                                                |
| 删除 | `tui/components/*.tsx`      | -8 文件                                                |

总计：新增/重写约 2300 行，删除约 1298 行。

---

## 对齐效果预期

| 维度           | 当前 SwiftyCode   | 对齐后                                 |
| -------------- | ----------------- | -------------------------------------- |
| 品牌色         | 琥珀（已对齐）    | 琥珀（保留）                           |
| 渲染模型       | scrollOffset 切片 | Static + 动态分离                      |
| 流式 markdown  | mergeTokens 全量  | 增量 + 前缀缓存 + 50ms 节流            |
| 闪烁消除       | 无                | Alt Screen + DEC 2026                  |
| 输入           | 单值 + includes   | 多行 + 5 层补全 + @提及 + ghost + 历史 |
| 权限           | 4 选项内联        | 4 选项 Swifty 风格对话框               |
| Spinner        | 无                | ink-spinner + 趣味动词 + token/elapsed |
| Ctrl+C         | 直接退出          | 双击退出 + 优雅关闭                    |
| context 进度条 | 有                | 保留                                   |
| daemon 连接    | 有                | 保留                                   |
| 事件重放       | 有                | 保留                                   |
