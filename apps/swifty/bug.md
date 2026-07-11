# Bug Report

## tmux/iterm 模式完全未接入（死代码）

`src/teams/backend.ts` 中定义了以下基础设施：

- `detectPaneBackend()` — 检测 tmux/iterm 环境
- `spawnTeammate(config)` — 独立函数，支持 tmux `new-window`/`new-session` 启动子进程

但这两者在整个代码库中从未被导入或调用：

1. `detectPaneBackend()` — 0 处 import，0 处调用
2. `backend.ts` 中的 `spawnTeammate()` — 0 处 import，0 处调用
3. `iterm` 模式即使在 `backend.ts` 内部也只是 `throw new Error("iTerm backend not supported on this platform")`

实际的 teammate 创建链路是：

```
TeamCreateTool / SpawnTeammateTool / AgentTool
  → TeamManager.create() → new Team(name, mode=detectBackend())
  → Team.spawnTeammate(name, task, runAgent)  // Team 类的方法，不是 backend.ts 的函数
```

`Team.spawnTeammate()` 是纯 in-process 实现（async 循环 + runAgent 回调），与 `backend.ts` 的 `spawnTeammate()` 完全无关。

结论：tmux/iterm 模式是完整的死代码，`backend.ts` 中的相关函数从未被接入实际流程。

## 同步 subagent 意外拥有 SendMessage 工具

`src/subagent/tool-filter.ts` 中 `filterToolsForAgent()` 的过滤逻辑存在漏洞：

对于同步 subagent（`isAsync = false`），Layer 4 的 `ASYNC_AGENT_ALLOWED_TOOLS` 白名单被跳过。而 `SendMessage` 工具不在任何 disallow 列表中：

- `ALL_AGENT_DISALLOWED_TOOLS` 不包含 SendMessage
- `CUSTOM_AGENT_DISALLOWED_TOOLS` 不包含 SendMessage
- `IN_PROCESS_TEAMMATE_ALLOWED_TOOLS` 是额外注入的白名单，不是过滤条件

导致的结果：同步 subagent 的 `filtered` registry 中会包含 `SendMessage` 工具，但 `SendMessageTool` 构造函数需要 `TeamManager` 实例，而 subagent 的 registry 中的 `SendMessageTool` 是从 parent registry 复制过来的同一个实例，指向 leader 的 `TeamManager`。

这意味着同步 subagent 可以通过 `SendMessage` 工具向 leader 的 team 发送消息，绕过了「只有 leader 可以 spawn teammate」的设计意图。

源码依据：

```typescript
// tool-filter.ts:74-131
export function filterToolsForAgent(
  registry: ToolRegistry,
  allowedTools: string[] | undefined,
  disallowedTools: string[] | undefined,
  isAsync: boolean,
  isCustom = false,
  isInProcessTeammate = false,
): ToolRegistry {
  // ...

  // Layer 4: Whitelist filtering for asynchronous Agents
  if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(name)) {
    // Layer 4b: In-process teammates get additional coordination tools
    if (!isInProcessTeammate || !IN_PROCESS_TEAMMATE_ALLOWED_TOOLS.has(name)) {
      continue;
    }
  }

  // Layer 5 & 6: Definition-level filtering
  // ...

  filtered.register(tool); // SendMessage 会在这里被注册
}
```

## TeamDelete 工具未清理磁盘资源

`src/teams/tools.ts` 中的 `TeamDeleteTool` 只做了两件事:

1. 调用 `team.stopAll()` 停止所有 teammate (设置 active=false, 调用 cancel)
2. 从内存 Map 中移除 team 对象

以下磁盘资源完全没有清理:

1. team 目录: `.swifty/teams/{teamName}/` (包含邮箱文件、transcript 文件)
2. 共享任务列表文件: `.swifty/tasks/{sessionId}.json`
3. worktree: 如果 teammate 使用了 worktree isolation, 对应的 git worktree 也没有删除

源码依据:

```typescript
// teams/tools.ts
export class TeamDeleteTool implements Tool {
  async execute(ctx, args) {
    const name = strArg(args, "name");
    await this.mgr.delete(name); // 只调用 delete, 没有其他清理逻辑
    return { output: `Team '${name}' deleted.`, isError: false };
  }
}

// teams/team.ts
export class TeamManager {
  async delete(name: string) {
    const team = this.teams.get(name);
    if (team) {
      await team.stopAll(); // 只停止 teammate
      this.teams.delete(name); // 只从内存移除
    }
    // 没有文件系统操作
  }
}
```

后果:

1. 磁盘空间泄漏: 每次创建/删除 team 都会遗留 `.swifty/teams/{name}/` 目录
2. 任务列表累积: `.swifty/tasks/*.json` 文件不会被清理, 长期运行后占满磁盘
3. worktree 残留: 如果启用了 isolation, git worktree 会一直存在, 占用文件系统空间

## 标签命名不一致：teammate 结果通知标签统一为 `<task-notification />`

原问题：源码中 teammate 使用 `<team-notification />`，而 background subagent 使用 `<task-notification />`，两者标签不同但功能类似。

已修复：用户已将源码和文档中的标签统一修正为 `<task-notification />`，用于所有子任务（teammate 和 background subagent）完成后的结果通知。
