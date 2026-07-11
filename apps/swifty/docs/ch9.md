# 指令文件、会话持久化、跨会话记忆

- 工作记忆: 上下文窗口
- 长期记忆: 持久化到磁盘
  - 指令文件 SWIFTY.md, AGENTS.md
  - 会话持久化
  - 自动记忆: Agent 在对话中自动积累的经验, 例如用户的编码偏好、项目的技术架构

## 指令文件

<!-- 源码: src/remote/agent-setup.ts, src/conversation/conversation.ts -->

Swifty 开启新会话时, 自动读取指令文件, 使用 `<system-reminder />` 标签包裹, 作为上下文注入到发送给 LLM API 的 messages 字段中

一个典型的 AGENTS.md

```md
# AGENTS.md

## Project

Swifty is an AI coding assistant TUI built with React + Ink. It talks to LLM providers (Anthropic, OpenAI, OpenAI-compatible) via tool-calling conversations.

## Tech Stack

TypeScript, React, Ink, Zod, Vitest, ESLint, oxfmt, pnpm workspace deps: `@swifty.js/glob-addon`, `@swifty.js/glob-wasm`.

## Code Conventions

Enforced by `eslint.config.js`.

### Type safety

- No `any`, no `!`, no `@ts-ignore`, no `as` casts.
- All `no-unsafe-*` rules are errors.
- Validate runtime data with Zod.

### Style

- File names: kebab-case.
- Control flow: always use braces (`curly: "all"`).
- Promises: must be awaited or voided.
```

### 优先级

<!-- 源码: src/memory/instructions.ts, discoverInstructions 函数 -->

`discoverInstructions` 按以下顺序发现并加载指令文件, 优先级从低到高

1. `~/.swifty/SWIFTY.md` 用户级, 最先加载
2. `~/.swifty/AGENTS.md` 用户级
3. projectRoot 仓库根目录到 workDir 工作目录的每一层目录的 `SWIFTY.md` 和 `AGENTS.md`
4. `${workDir}/.swifty/INSTRUCTIONS.md` legacy 兼容
5. `${workDir}/SWIFTY.local.md` 本地覆盖, 最后加载, 最高优先级

指令文件按顺序加载, 后加载的指令文件不会覆盖先加载的指令文件, 多个指令文件会被拼接, 使用 --- 分隔

prompt 中靠后的内容, 得到的 LLM 注意力更多, 冲突时优先级更高

## `@` 引用指令

可以在指令文件中使用 `@` 引用其他文件 <!-- 源码: src/memory/instructions.ts -->

```md
# SWIFTY.md

@./docs/project.md
@./docs/tech-stack.md
@./docs/conventions.md
```

支持的路径格式 <!-- 源码: src/memory/instructions.ts -->:

- `@./relative/path`, `@../parent/path`
- `@~/home/path`
- `@/absolute/path`

````js
const MAX_INCLUDE_DEPTH = 5;

function expandIncludes(content, baseDir, seen, depth, projectRoot) {
  if (depth > MAX_INCLUDE_DEPTH) {
    return content;
  }
  const lines = content.split("\n");
  const out = [];
  let inCode = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测 markdown 代码块边界
    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      out.push(line);
      continue;
    }

    if (!inCode) {
      const includePath = parseInclude(trimmed);
      if (includePath) {
        const abs = resolve(includePath, baseDir);
        if (!seen.has(abs)) {
          // 只允许 projectRoot 和 ~/.swifty
          if (!isIncludeAllowed(abs, projectRoot)) {
            out.push("<!-- @include skipped: path outside project -->");
            continue;
          }
          const data = readFileSync(abs, "utf-8");
          seen.add(abs);
          out.push(`<!-- included from ${includePath} -->`);
          out.push(expandIncludes(data, dirname(abs), seen, depth + 1, projectRoot));
          continue;
        }
      }
    }
    out.push(line);
  }
  return out.join("\n");
}
````

安全风险

1. 无限递归: SWIFTY.md 引用 CLAUDE.md, CLAUDE.md 引用 SWIFTY.md, 导致无限递归; 使用 `depth` 参数限制最大递归深度
2. 重复 inline 同一个文件: 维护 `seen` 集合, 记录已 inline 的绝对路径, 遇到已 inline 的绝对路径直接跳过
3. 路径越界: `@` 引用的路径必须在项目目录或 `~/.swifty` 内, 越界的路径会被替换为注释 `<!-- @include skipped: path outside project -->`

## 会话持久化

Swifty 的会话持久化使用 JSONL 格式 (JSON lines), 每行一个 JSON 对象, 代表一条消息

为什么不使用 sqlite?

- 引入额外的依赖, 提高打包复杂度, 增大打包产物体积
- 用不上 sqlite 的条件查询能力

为什么不使用普通 JSON?

- 使用普通 JSON, 新增一条消息需要:
  - 读取文件为 JSON 字符串
  - 反序列化 JSON 字符串为数组
  - 向数组中 push 一个元素
  - 序列化数组为 JSON 字符串
  - 将 JSON 字符串写回文件, 如果写崩溃, 则损坏整个会话数据
- 使用 JSONL
  - 追加写入: 新增一条消息, 直接追加到文件尾部 <!-- 源码: src/session/session.ts, saveMessage 使用 flag "a" -->
  - 增量加载: 恢复会话时逐行读取, 遇到解析失败的行直接跳过 <!-- 源码: src/session/session.ts, loadSession -->
  - 如果写崩溃, 只损坏最后一行

```json
{
  "role": "user",
  "content": "Write a WeChat",
  "timestamp": 1783277127000
}
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "OK, let me ..." },
    {
      "type": "tool_use",
      "id": "tool_use_abc123",
      "name": "ReadFile",
      "input": {
        "path": "/path/to/project/main.ts",
        "timestamp": 1783277280000
      }
    }
  ]
}
// 对于 Claude API, tool_result 放在 role 为 user 的消息中, 使用 tool_result 类型的 content block 传递
{
  "role": "tool_result",
  "tool_use_id": "tool_use_abc123",
  "content": "import ...",
  "timestamp": 1783277384000
}
{
  "role": "assistant",
  "content": "OK, let me ...",
  "timestamp": 1783277510000
}
```

## 会话日志

会话日志放在项目的 .swifty/sessions 目录下

追加消息时, 先写 jsonl 文件, 再更新内存 <!-- 源码: src/session/session.ts -->

- 如果先写 jsonl 文件再更新内存, 更新内存失败进程崩溃时, 恢复会话可以从 jsonl 文件重建
- 如果先更新内存再写 jsonl 文件, 写 jsonl 文件失败进程崩溃时, 恢复会话消息丢失

```txt
.swifty/
  sessions/
    YYYY-MM-DD-hh:mm:ss-hash.jsonl
```

## 恢复会话

1. 逐行读取, 遇到解析失败的行直接跳过 <!-- 源码: src/session/session.ts, loadSession -->
2. 校验消息链的完整性: 追踪所有的工具调用, 截断到最后一个「所有的工具调用都有结果」的位置, 避免 LLM 看到有一个工具调用但是没有结果, 感到困惑
3. 检查 token 用量: 如果恢复的对话历史很长, token 用量可能超过压缩阈值, 直接触发上下文压缩
4. 插入时间跨度提示词: 如果距离上次会话活跃超过 24h, 在对话历史中插入一条消息提醒 LLM: 距离上次会话活跃 ?h, 可能有代码变更, 建议重新读取相关文件, 避免 LLM 使用过期的文件内容做决策

## 过期会话清理

Swifty 启动时, 自动清理 .swifty/sessions 目录下超过 30 天没有活跃的会话日志 <!-- 源码: src/session/session.ts SESSION_EXPIRY_DAYS = 30, src/session/session.ts cleanExpiredSessions -->

## 自动记忆

例如要求 Agent: 缩进用 2 个空格, 不要用 4 个空格

<!-- 源码: src/memory/manager.ts -->

- 用户偏好, 存储到 `~/.swifty/memory`
- 项目知识, 存储到 `${workDir}/.swifty/memory`

<!-- 源码: src/memory/manager.ts, parseFrontmatter -->

每条记忆是一个独立的 .md 文件, 有 yaml frontmatter 描述元信息

```txt
.swifty/memory/
  MEMORY.md # 索引文件, 注入到 messages 字段
  no-type-assertions.md
  validate-runtime-data-with-zod.md
```

<!-- 源码: src/memory/manager.ts, MAX_ENTRYPOINT_LINES = 200, MAX_ENTRYPOINT_BYTES = 25_000 -->

MEMORY.md 索引文件注入到 messages 字段时有 token 上限, 最多 200 行或 25KB (2k-3k tokens), 超过会截断并附加警告, 防止记忆太多撑满上下文

<!-- 源码: src/memory/manager.ts, rebuildIndex -->

```md
- [No `any`, no `!`, no `@ts-ignore`, no `as` casts](./no-type-assertions.md) — 禁止使用 any、非空断言、@ts-ignore 和 as 类型断言
- [Validate runtime data with Zod](./validate-runtime-data-with-zod.md) — 使用 Zod 校验运行时数据
```

## 记忆加载

 <!-- 源码: src/remote/agent-setup.ts, src/conversation/conversation.ts -->

Swifty 开启新会话时, 自动读取指令文件和 MEMORY.md, 使用 `<system-reminder>` 标签包裹, 作为上下文注入到发送给 LLM API 的 messages 字段中; 如果某条记忆的 description 和当前任务相关, LLM 可以调用 ReadFile 读取对应的记忆文件

## 记忆提取

<!-- 源码: src/memory/extractor.ts (TODO) -->

每轮 agent loop 结束后, 记忆提取 subagent 后台异步请求 LLM API (不阻塞下一轮对话的用户输入), `MemoryExtractor` 将

- 对话历史
- MEMORY.md 索引文件 (记忆提取 subagent 的 system prompt 中包含 MEMORY.md 索引文件)
- 记忆文件的描述列表 (记忆提取 subagent 的 prompt 中包含记忆文件的描述列表)

发送给 LLM; LLM 分析对话, 决定是否提取新记忆

提取的新记忆根据类型路由到不同目录

- project 和 reference 类型的新记忆写入到 `${workDir}/.swifty/memory` 工作目录
- user 和 feedback 类型的新记忆写入到 `~/.swifty/memory` 全局目录
- 写入后自动调用 rebuildIndex 重建 MEMORY.md 索引文件

## 记忆整理 (autoDream, 未实现)

Swifty 后台定期执行「记忆整理」, fork 一个 subagent, grep 最近的会话日志

- 收集新记忆
- 删除过时记忆
- 合并重复记忆
- 修复冲突记忆
- 更新索引文件

记忆整理的触发条件

```js
function shouldAutoDream() {
  if (记忆目录不存在 ||
    距离上一次成功的记忆整理 < 24h ||
    1h 内执行过记忆整理 ||
    累积会话数量 < 5 ||
    获取锁失败)
    return false;
  }
  return true;
}
```

## 防止并发冲突: 锁文件 (未实现)

如果同时打开两个终端运行 Swifty, 两个进程可能同时触发记忆整理

Swifty 使用锁文件 .swifty/memory/.consolidate-lock 防止并发冲突, 锁文件保存占有锁的进程 PID, 锁文件的 mtimeMs (最近修改时间) 代表上一次记忆整理完成的时间

获取锁

1. 尝试获取锁文件的进程, 读取锁文件的 PID 和 mtimeMs

- 如果锁文件的 mtimeMs 距离现在 < 1h, 则放弃
- 如果锁文件的 mtimeMs 距离现在 >= 1h
  - PID 不存在 ->
    - 锁文件的 mtimeMs 距离现在 < 24h: 24h 内执行过记忆整理, 放弃
    - 锁文件的 mtimeMs 距离现在 >= 24h: 写入 PID, 回读锁文件, 确保没有被其他进程抢占, 执行记忆整理
  - PID 对应的进程存在 -> 上一次记忆整理超时: 杀死该进程, 重写锁文件
  - PID 对应的进程死亡 -> 上一次记忆整理时进程崩溃: 重写锁文件

2. 如果记忆整理成功, 则清空锁文件 (记录记忆整理完成时间)
3. 如果记忆整理失败, 则清空锁文件, 使用 `utimesSync` 锁文件的 mtimeMs 重置为获取锁文件前的值
4. 如果记忆整理时进程崩溃 (PID 残留), 下一次记忆整理时, 进程读取锁文件后, 如果 PID 对应的进程死亡, 则重写锁文件
5. 如果记忆整理超时 (1h), 下一次记忆整理时, 进程读取锁文件后, 如果 PID 对应的进程存在, 并且锁文件的 mtimeMs 距离现在 >= 1h, 则杀死该进程, 重写锁文件

```js
import { statSync, writeFileSync, utimesSync } from "node:fs";

const { mtimeMs } = statSync("/path/to/.swifty/memory/.consolidate-lock");

// 记忆整理失败
writeFileSync("/path/to/.swifty/memory/.consolidate-lock", "");
utimesSync(
  "/path/to/.swifty/memory/.consolidate-lock",
  Date.now() /** atimeMs, last access time */,
  mtimeMs /** last modify time */,
);
```

### 记忆整理过程 (未实现)

记忆整理由 fork 的一个 subagent 执行, 不阻塞用户交互

对 subagent 工具调用的限制

- Bash 工具: 只允许执行只读命令
- WriteFile 工具: 只允许写入 .swifty/memory 目录

记忆整理 prompt

- 定位阶段: `ls .swifty/memory`, 读 MEMORY.md 索引文件, 读记忆文件
- 收集阶段: grep 最近的会话日志, 收集新记忆
- 整理阶段: 删除过时记忆, 合并重复记忆, 修复冲突记忆
- 更新索引文件: 更新 MEMORY.md

## 记忆提取和记忆整理

<!-- 源码: src/memory/extractor.ts -->

- 记忆提取每轮 agent loop turn 结束后都可能触发, 频率高、消耗小、影响小
- 记忆整理每隔 24h 才可能触发, 频率低、消耗大、影响大
