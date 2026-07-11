# System Prompt

## System Prompt

system prompt 分为 7 个模块 (section), 按 priority 排序后拼接

- agent 的角色 (Identity, priority 0)
- 系统原则 (System, priority 10)
- 执行任务规范: 例如是否加注释, 是否拆分组件, 是否重构 (Doing Task, priority 20)
- 动作规范: 例如禁止猜测 API, plan 模式、auto 模式的执行策略 (Executing Actions, priority 30)
- 工具调用指南: 例如使用 cat 还是 ReadFile, 多个工具调用串行还是并行 (Using Tools, priority 40)
- 语气风格: 例如不要使用表情符号 (Tone Style, priority 50)
- 文本输出: 例如 1-2 sentences 的回复 (TextOutput, priority 60)
- 环境上下文 (Environment, priority 70)

## Prompt 的 7 个来源、3 个字段

### 7 个来源

| 来源                                         | 字段     | 原因                                          |
| -------------------------------------------- | -------- | --------------------------------------------- |
| System Prompt                                | system   | 始终生效, 内容稳定可以缓存                    |
| 环境上下文: 操作系统、工作目录...            | system   | 每个会话确定后不再改变, 可以缓存              |
| 工具描述: 工具的 description, input_schema   | tools    | LLM API 规范                                  |
| 指令文件: SWIFTY.md / AGENTS.md              | messages | 内容可能很长, 放在 system 可能稀释 LLM 注意力 |
| 自动记忆: agent 自动沉淀的用户偏好和项目知识 | messages | 内容可能变化                                  |
| system reminder: 动态注入的上下文            | messages | 特定时机注入 `<system-reminder />`            |
| 对话历史                                     | messages | LLM API 规范                                  |

> system 字段的优先级最高, 为什么不都设置为 system 字段?

1. prompt cache, LLM API 支持 prompt cache, 如果 system 字段的值和上一次请求完全相同, 则 LLM API 会复用缓存, 降低 input token 的计费; system prompt 内容稳定, 每次请求都可以命中缓存
   - 稳定的内容放在 system 字段、变化的内容放在 messages 字段
   - 如果指令文件和自动记忆放在 system 字段, 则会频繁使得 prompt cache 缓存失效
   - 环境上下文每个 session 不同, 但是一个 session 中是稳定的, 可以使用分层缓存: 全局缓存、会话级缓存
2. system 字段内容太长, 可能会稀释 LLM 注意力
3. 可压缩性: messages 字段的内容, 后续可以被上下文压缩处理; 但是 system 字段的内容不会被压缩, 每次发送 LLM 请求时都会完整携带; 如果指令文件的内容后期不再需要, /compact 可以压缩或删除, 但是 system 字段的内容不会被上下文压缩处理, 每次请求都会完整携带

```js
function assembleAPIPayload(config, conversationHistory) {
  // system 字段: 稳定的 system prompt + 会话级上下文
  const system = buildSystemPrompt(config);

  // 环境上下文也放到 system 字段, 使用缓存分层管理
  const envContext = buildEnvironmentContext(config);
  system += "\n\n" + envContext;

  // message 字段: 存放变化的内容
  const messages = [];

  // 指令文件 (AGENTS.md, CLAUDE.md, SWIFTY.md)
  const instructions = loadInstructionFiles(config.workDir);
  if (instructions) {
    messages.push(systemReminder(instructions));
  }

  // 自动记忆
  const memories = loadMemories(config);
  if (memories) {
    messages.push(systemReminder(memories));
  }

  // 对话历史
  messages.push(...conversationHistory);

  // 动态上下文 (MCP Server、可用 skill 列表)
  const dynamicCtx = buildDynamicContext(config);
  if (dynamicCtx) {
    messages.push(systemReminder(dynamicCtx));
  }

  // tools 字段: 工具描述
  const tools = registry.getEnabledToolSchemas();

  return { system, messages, tools };
}
```

### 工具描述也是 prompt 工程

3 个字段

- system
- messages
- tools

工具描述不是注释, 是 prompt 的一部分; LLM 根据 description 做决策: 什么时候调用这个工具, 如何调用这个工具; 好的工具描述和 system prompt 的「工具调用指南」有重叠, 例如优先 ReadFile 而不是 bash、cat; 重复说明, LLM 遵守的概率会更高

### 动态指令注入: `<system-reminder />`

#### 信息的来源

- system prompt: 会话开始时确定
- 会话历史: 随会话产生
- 会话过程中产生, 需要立刻让 LLM 知道: 例如会话过程中, 用户通过配置连接了一个 MCP Server, 这个 MCP Server 提供了多个新工具, Agent 需要立刻知道这些工具的描述; 但是不能修改 system prompt, 修改 system prompt 会使得 prompt cache 失效; 但也不能作为用户消息, 否则 LLM 可能会回复

#### 什么是 `<system-reminder />`

`<system-reminder />` 是一种特殊的消息标记, 放在 messages 字段中, 以告诉 LLM 这是补充的 system prompt

1. 训练阶段, LLM 理解「xml 标签间的内容是一块有语义的单元」
2. 微调/RLHF 阶段

- Anthropic 在微调时使用 `<system-reminder />`
- OpenAI 在 tokenizer 时使用 `<|im_start|>system<|im_end|>`
- OpenAI Codex: 使用 `<environment_context>`, `<INSTRUCTIONS>`, `<objective>`

LLM 看到 `<system-reminder />`, 就知道标签间的内容是当指令对待, 而不是当用户消息对待; 不回复这段内容, 而是加入到工作上下文

#### 典型使用场景

- MCP server 上线或下线
- 可用 skill 列表更新
- agent 配置更新
- 温和提醒
- SWIFTY.md / AGENTS.md 内容注入

#### 为什么不能直接改 system prompt

1. 改 system prompt 会让 prompt cache 失效
2. prompt cache 按前缀匹配, 顺序是 tools -> system -> messages, 直接改 system prompt 会导致后面的 message 的缓存全部失效
3. `<system-reminder />` 和用户消息需要作为独立的 content block, 不能拼在一起; 如果 `<system-reminder />` 的内容包含外部文本, 需要预防 prompt 注入

## Pitfall

- Prompt 太长, 中间指令被忽略
  - LLM 的注意力不是均匀的, 开头和结尾得到的注意力最多, 中间内容最容易被忽略
  - 使用 markdown 标题; 或者重复说明, 提高 LLM 遵守的概率
- 前后指令冲突: 在 system prompt 中明确优先级
- 关键指令重复说明, 提高 LLM 遵守的概率

## Prompt 与成本

每轮 agent loop turn 都需要调用 LLM API, 每次调用 LLM API 都需要发送 system + tools + messages, 其中 system + tools 的内容几乎不变, messages 的内容随对话增长。

usage 字段包含 4 个 token 计数 (Anthropic):

<!-- 源码: src/llm/anthropic.ts -->

- inputTokens: 未命中 prompt cache 的输入 token 数, 即发送给 LLM 的内容, 即 system_prompt, tools 描述和 messages 中未命中 prompt cache 的输入
- outputTokens: 输出 token 数, 即 LLM 生成的内容, 输出 token 比输入 token 贵的多
- cacheReadInputTokens: 命中 prompt cache 的输入 token 数, 价格远低于普通 input_tokens
- cacheCreationInputTokens: 创建 prompt cache 的输入 token 数, 价格略高于普通 input_tokens

简化的成本公式:

```txt
单轮成本 =
    input_tokens          * input_price
  + cache_read_tokens     * cache_read_price (通常是 input_price 的 1/10)
  + cache_creation_tokens * cache_creation_price (通常是 input_price 的 1.25 倍)
  + output_tokens         * output_price

input_tokens + cache_read_tokens + cache_creation_tokens
  = system_tokens + tools_tokens + messages_tokens
```

<!-- 源码: src/llm/anthropic.ts (let cacheReadInputTokens = 0; let cacheCreationInputTokens = 0;) -->
<!-- 源码: src/llm/anthropic.ts (从 message_start.usage 读取 cache_read_input_tokens / cache_creation_input_tokens) -->

Prompt 设计在 3 个方面影响成本

1. system prompt 的长度: 多轮调用间需要保持不变
2. output 的长度: 行为准则要求「简洁还是详细」, 影响每轮的 output_tokens
3. 工具调用的效率: 多个独立任务并发调用工具, 减少 LLM API 请求次数; 每少一次 LLM API 请求, 就少一次完整的 input_tokens 传输, 极大降低 input_tokens 成本
