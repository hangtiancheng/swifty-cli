# 上下文压缩

> 开启新对话, 调用 LLM API 压缩上下文

LLM API 是无状态的, 每个 LLM API 请求, 都需要发送完整的对话历史, 包括调用 ReadFile 工具读的每个文件、调用 Bash 工具执行的每条命令和输出, token 数量随对话轮次线形增长

### Agent Loop

工具调用结果 token 消耗占比最高, 也最容易过时: 例如第 3 个 turn 调用 ReadFile 工具读 main.js, 第 5 个 turn 调用 WriteFile 工具写 main.js; 第 10 个 turn 时, 第 3 个 turn 读的旧版本的 main.js 内容已过时, 需要上下文压缩

## 两层压缩

## 第 1 层: 大结果存磁盘

### 单个工具调用结果的阈值

<!-- 源码: src/tool-result/budget.ts SINGLE_RESULT_LIMIT = 50000 -->

单个工具调用结果超过 50k 字符时 (约 12.5k tokens), CLI 不会将大结果 push 到对话历史, 而是将大结果写入磁盘文件, 向对话历史中 push 一个预览, 使用 `<persisted-output />` 标签包裹, 包含文件大小、文件路径和前 2k 字符

```xml
<persisted-output>
Output too large (80KB). Full content saved to:
.swifty/tool_results/{toolUseId}

Preview (first 2KB):
...
</persisted-output>
```

大结果保存到磁盘文件, LLM 通常看预览就足够理解上下文; 真正需要完整内容时, 调用 ReadFile 工具读磁盘文件即可 (prompt cache 友好)

### 单条消息中多个工具调用结果的聚合限制

<!-- 源码: src/tool-result/budget.ts MESSAGE_AGGREGATE_LIMIT = 200000 -->

一轮对话中, 并发调用 10 个工具, 每个工具调用结果是 40k 字符, 单个工具调用结果都 < 50k 字符, 但是聚合总量是 400k

所以有单条消息中多个工具调用结果的聚合限制 200k, 超过 200k 字符时, 按工具调用结果的大小降序排序, 将最大的工具调用结果溢出到磁盘, 直到聚合大小降低到 200k 以内

## 第 2 层: 生成对话摘要, 保留近期消息原文, 恢复关键上下文 (Auto-Compact)

第 1 层不够用时

- LLM 侧: 生成对话摘要
- CLI 侧: 保留近期消息原文, 恢复关键上下文: 工具列表、skills、最近访问的文件

### LLM 侧: 生成对话摘要

#### 自动压缩阈值

以 200k tokens 上下文窗口为例

- 200_000 (上下文窗口) - 20_000 (预留给对话摘要) = 180_000 (effectiveWindow 有效上下文窗口)
- 180_000 (有效上下文窗口) - 13_000 (安全余量, 经验值) = 167_000 (自动压缩阈值)
- buffer 大小: 20k + 13k = 33k

自动压缩的检查点是每轮 agent loop turn 开始

- 第 n 次自动压缩检查: 178_000 tokens, 不会触发上下文压缩
- 一轮 agent loop turn, 消耗 10_000 tokens
- 第 n+1 次自动压缩检查: 188_000 tokens, 预留给对话摘要只有 12_000 tokens, 低于 20k 预算, 所以需要 13k 的安全余量

#### 为什么不设置为「上下文窗口用量到达 x% 时触发」?

20k + 13k = 33k 的 buffer 预防的是一轮 agent loop turn 的 token 消耗, 和上下文窗口总大小 (200k, 1M ...) 无关, 不存在一个百分比同时适配所有的上下文窗口大小

#### 为什么预留 20k 给对话摘要

<!-- 源码: src/compact/compact.ts SUMMARY_OUTPUT_RESERVE = 20000 -->

预留给对话摘要 20k tokens: 对话摘要有 9 个结构化部分 (见下文: 摘要 prompt 的设计) 和 `<analysis />` 草稿块, 一个复杂会话的摘要输出大约 15k 到 18k 的 tokens, 设置为 15k 有被截断的风险

## 摘要 prompt 的设计

<!-- 源码: src/compact/compact.ts -->

prompt 开头和结尾, 重复禁止 LLM 生成摘要时调用任何工具, 仅输出纯文本: Swifty 请求 LLM API 生成摘要时, 也会携带 tools 参数, 目的是命中 prompt cache (prompt cache 按前缀匹配, 顺序是 tools -> system -> messages)

摘要的质量直接决定上下文压缩后 Agent 的表现, 一个好的摘要 prompt 要求 LLM 生成一份结构化摘要, 明确 9 个部分:

1. 用户的请求和意图
2. 相关技术栈
3. 相关文件和代码片段
4. 技术方案
5. bugfix
6. 所有用户的、非工具调用结果的消息, 原文保留
7. TODO List
8. 当前工作: 最详细
9. 可能的下一步

#### 两阶段生成: 先打草稿再写正文

先打草稿再写正文, 可以显著提升摘要质量; prompt 要求 LLM 先输出 `<analysis />` 草稿块, 再输出正式的 `<summary />` 摘要块, 最终只保留 `<summary />`, `<analysis />` 被丢弃

```
Summarize the following conversation.
Wrap your analysis in <analysis> tags, then provide the summary in <summary> tags.
```

### CLI 侧: 压缩恢复 (保留近期消息原文, 恢复关键上下文)

近期 10k tokens 或者至少 5 条消息保留原文, 并且附加以下内容

- 工具列表
- skills, 预算 25k tokens
- 会话记录日志路径
- 最近访问的文件, 最多附加 5 个, 每个最多 5k tokens

压缩后的对话历史

```md
[system] You are Swifty, a terminal AI programming assistant...

<!-- 对话摘要 -->

[user] This session continues from a previous conversation, which has been compressed due to context limitations. Here is a summary of the earlier messages:

(摘要内容)

Recent messages have been preserved verbatim.

<!-- 会话记录日志路径 -->

If you need specific details from before compaction (code snippets, error messages, etc.), use ReadFile to read the full session transcript: $HOME/path/to/.swifty/sessions/YYYY-MM-DD-abc123.jsonl

---

<!-- 最近访问的文件 -->

## Recently read files

These snapshots are what the file-reading tool last returned. Re-open with the tool if you need the current bytes.

### handler.ts (read 2026-07-08T12:34:56Z)

(文件内容, 最多 5k tokens)

### middleware.ts (read 2026-07-08T12:35:12Z)

(文件内容, 最多 5k tokens)

<!-- 最近加载的 skills -->

## Active skills

These skills were invoked earlier in the session. Continue to follow each SOP when its triggering condition applies.
(skill body, 最多 5k tokens, 预算 25k tokens)

<!-- 可用工具列表 -->

## Available tools

You still have access to the following tools — call them directly when the task needs one:

- ReadFile
- WriteFile
- Bash

## Note

Everything above the divider is reconstructed context. For exact code, error strings, or user-typed text, re-read the source rather than guess from the summary.

(以下是保留的近期消息原文)
```

<!-- 源码: src/compact/compact.ts, src/compact/recovery.ts -->

摘要内容、会话记录日志路径、恢复的关键上下文 (最近访问的文件、最近加载的 skills、可用工具列表) 拼接在一条 user 消息中, 使用 --- 分隔, 后面是保留的近期消息原文; 两条连续的 user 消息会被自动合并为一条

## 熔断机制

<!-- 源码: src/compact/compact.ts MAX_CONSECUTIVE_FAILURES = 3 -->

- 如果摘要请求因为网络错误、LLM API 错误等连续失败 3 次, 则熔断器触发, 停止重试
- token 用量继续涨到强制压缩阈值时, 即使熔断器已触发, 仍会强制压缩上下文
- 如果摘要请求报错 prompt too long, 可以丢弃最旧的几轮消息, 使用剩余消息重试 (TODO)

## 强制压缩

以 200k tokens 上下文窗口为例

- 200_000 (上下文窗口) - 20_000 (预留给对话摘要) = 180_000 (effectiveWindow 有效上下文窗口)
- 180_000 (有效上下文窗口) - 13_000 (安全余量, 经验值) = 167_000 (自动压缩阈值)
- buffer 大小: 20k + 13k = 33k

1. token 用量涨到强制压缩阈值 167k 时, 即使熔断器已触发, 仍会强制压缩上下文
2. 自动压缩连续失败 3 次, 熔断停止重试
3. token 用量继续涨到 (effectiveWindow - 3000 = 177k) 时强制压缩

## 手动 /compact

输入 /compact 手动触发上下文压缩, 2 个典型场景:

1. 预防性压缩: 接下来会读大量文件, 提前压缩上下文
2. 话题切换

## @/tool-result/budget.ts 的 `applyBudget`

<!-- 源码: src/tool-result/budget.ts -->

```txt
为什么统计实际 agent loop turn 数需要统计 role 是 assistant 并且没有 tool_use 的消息数量?

- user:      "帮我修复 bug"          <- role=user, turn 开始
- assistant: [请求调用工具 ReadFile] <- role=assistant, tool_use
- user:      [ReadFIle 工具调用结果] <- role=user, tool_result
- assistant: [请求调用工具 EditFile] <- role=assistant, tool_use
- user:      [EditFile 工具调用结果] <- role=user, tool_result
- assistant  "Bug 已修复"            <- role=assistant, turn 结束, 没有 tool_use
```

- 阶段 1: 单个工具调用结果超过 50k 字符时 (SINGLE_RESULT_LIMIT), 溢出到磁盘, 替换为预览, 使用 `<persisted-output />` 标签包裹, 包含文件大小、文件路径和前 2k 字符
- 阶段 2: 单条消息中多个工具调用结果的聚合限制: 200k (MESSAGE_AGGREGATE_LIMIT), 超过 200k 字符时, 按工具调用结果的大小降序排序, 将最大的工具调用结果溢出到磁盘, 直到聚合大小降低到 200k 以内
- 阶段 3 (Snip stale): 裁剪历史消息中旧的工具调用结果, 统计实际 agent loop turn 数 (统计 role 是 assistant 并且没有 tool_use 的消息数量), 保留最近 10 个 turn 的工具调用结果, 将更早的 turn 中超过 2000 字符的工具调用结果替换为 `[Stale output snipped: N chars]`; 被替换过的工具调用结果 (以 `<persisted-output>` 或 `[Stale output snipped:` 开头) 不会被重复处理

最大的工具调用结果溢出到磁盘, 保存到 `.swifty/tool_results/{toolUseId}`
