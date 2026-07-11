# LLM API、对话管理

请求 Demo

```bash
# Anthropic
curl https://api.anthropic.com/v1/messages \
  -H 'Content-Type: application/json'      \
  -H 'anthropic-version: 2023-06-01'       \
  -H "X-Api-Key: $ANTHROPIC_API_KEY"       \
  -d '{
    "max_tokens": 1024,
    "model": "claude-sonnet-4-6",
    "messages": [
      {
        "role": "user",
        "content": "Hello claude."
      }
    ]
  }'
```

响应 Demo

<!-- 源码: src/llm/anthropic.ts (usage 字段) -->

```json
{
  "id": "msg_abcdefghijklmn0123456789",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I assist you today?"
    }
  ],
  "model": "claude-sonnet-4-6",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 12,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0
  }
}
```

- 请求的 messages: 每条 message 有 role 和 content 两个字段, role (API 请求场景下) 只有两个值: user 和 assistant; messages 数组中, 最好保持 user 和 assistant 两个 role 交替出现; 如果连续传递两条 user 消息, API 不会报错, 会自动合并为一条 user 消息
- LLM 返回一个工具调用 (tool_use) 请求, 这是 assistant 消息; 用户调用工具拿到结果, 该工具调用结果需要作为 user 消息发送; 如果错误的将工具调用结果作为 assistant 消息发送, 则会导致连续两条 assistant 消息, API 会直接报错
- 响应的 content 字段是一个数组: LLM 的响应可能包含多种内容, 每种内容是一个独立的 content block, 类型可能是 text、tool_use 等
- 流式响应基于 SSE (Server-Sent Events), 本质是 HTTP 长连接

Claude 的流式事件有固定顺序

<!-- 源码: src/llm/anthropic.ts (SSE 事件处理) -->

```txt
message_start 整个响应开始, 携带 input_tokens 输入 token 数、cache_read_input_tokens、cache_creation_input_tokens
  content_block_start 一个内容块开始 (thinking 推理、text 文本或 tool_use 工具调用), 一个响应可能有多个 content_block 内容块
    content_block_delta 内容块的内容增量, delta.type 有 4 种:
      text_delta 文本增量, 每到达一个词, 可以将内容增量提交给 UI 渲染
      thinking_delta 推理增量
      input_json_delta 工具调用参数增量
      signature_delta 签名增量
  content_block_stop 一个内容块结束
message_delta 消息增量 (output_tokens 输出 token 数, stop_reason 停止原因)
message_stop 整个响应结束
```

<!-- 源码: src/llm/events.ts (StreamEvent) -->

封装层将 LLM API 的 SSE 事件映射到 CLI 的 StreamEvent:

```txt
content_block_delta (text_delta)       -> text_delta
content_block_delta (thinking_delta)   -> thinking_delta
content_block_stop                     -> thinking_complete
content_block_start (tool_use)         -> tool_call_start
content_block_delta (input_json_delta) -> tool_call_delta
content_block_stop                     -> tool_call_complete
message_stop                           -> stream_end
```

## 请求的 system, messages, tools

- system 参数存放用户信息和环境信息, 包括: 你是谁、操作系统是什么、工作目录是什么
- messages 参数存放对话历史、上下文窗口
- tools 参数存放工具描述

<!-- 源码: src/llm/anthropic.ts -->
<!-- 源码: src/tools/read-file.ts (ReadFile 工具定义、描述) -->

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 4096,
  "system": [
    {
      "type": "text",
      "text": "You are Swifty, a terminal AI programming assistant.\n\n# Environment\nOperating System: MacOS\nWorking Directory: /path/to/cwd\nCurrent Time: 2026-06-22",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [
    { "role": "user", "content": "Explain the contents of ./app.ts." },
    {
      "role": "assistant",
      "content": "Sure, let me read the contents of ./app.ts.\nfunction main() {\n  console.log(\"javascript newbie\")\n}"
    },
    { "role": "user", "content": "What functions are in this file?" }
  ],
  "tools": [
    {
      "name": "ReadFile",
      "description": "Read a file and return its contents with line numbers.\n\nUsage Notes\n\n- The file_path should be an absolute path when possible.\n- By default reads up to 2000 lines from the beginning of the file.\n- Use offset and limit to read specific parts of large files.",
      "input_schema": {
        "type": "object",
        "properties": {
          "file_path": {
            "type": "string",
            "description": "Absolute path to the file"
          },
          "offset": {
            "type": "integer",
            "description": "Line number to start from (0-based)",
            "default": 0
          },
          "limit": {
            "type": "integer",
            "description": "Max lines to read",
            "default": 2000
          }
        },
        "required": ["file_path"]
      }
    }
  ]
}
```

<!-- 源码: src/llm/anthropic.ts (最后一个 tool 标记 cache_control) -->

### OpenAI 兼容

<!-- 源码: src/llm/openai.ts (OpenAIClient.stream) -->

```json
{
  "model": "gpt-4.1",
  "max_output_tokens": 4096, // 使用 max_output_tokens 而不是 max_tokens
  "input": [
    // 使用 input 而不是 messages
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" }
  ],
  "stream": true
}
```

OpenAI 没有 prompt cache 的 cache_control, cache_read 通过 `usage.input_tokens_details.cached_tokens` 返回

<!-- 源码: src/llm/openai.ts (OpenAI cache_read 解析) -->

## token

token 是 LLM 的计费单位, 每个英文单词约 1-2 个 token, 每个汉字约 1-2 个 token, 具体取决于 LLM 使用的 tokenizer

Claude API 的计费分为

- inputTokens: 未命中 prompt cache 的输入 token 数, 即发送给 LLM 的内容, 即 system_prompt, tools 描述和 messages 中未命中 prompt cache 的输入
- outputTokens: 输出 token 数, 即 LLM 生成的内容, 输出 token 比输入 token 贵的多
- cacheReadInputTokens: 命中 prompt cache 的输入 token 数, 价格远低于普通 input_tokens
- cacheCreationInputTokens: 创建 prompt cache 的输入 token 数, 价格略高于普通 input_tokens

<!-- 源码: src/llm/events.ts (UsageInfo 接口, 包含 4 个 token 字段) -->

### 历史越长、输入越贵

每轮请求, 都需要发送完整的对话历史; 如果和 LLM 聊了 20 轮, 第 21 轮请求会包含前 20 轮的所有消息; input_tokens 会随着对话轮次线形增长, 所以需要上下文压缩

## Extend Thinking 推理

Claude 支持 Extended Thinking, 让 LLM 回复前先进行内部推理, 开启后响应的 content 数组中会多一个 `type: thinking` 的内容块, 排在 text 内容块的前面; thinking 的 token 计算到 output_tokens 中;

包含工具调用的一轮对话, 对话历史中的 thinking 内容块必须携带, 和后面的 tool_result 一起发送给 LLM API, 否则会报错; 对于纯聊天、没有工具调用的场景, 则对话历史中的 thinking 内容块可以不携带, LLM API 会自动忽略

<!-- 源码: src/conversation/conversation.ts (ThinkingBlock 接口: thinking + signature) -->
<!-- 源码: src/llm/anthropic.ts (assistant 消息 thinking block 的 API 转换) -->

## 如何封装

ProviderConfig 有 8 个字段, 覆盖主流厂商: Anthropic、OpenAI、OpenAI 兼容层

<!-- 源码: src/config/config.ts (ProviderConfigSchema) -->

- name: provider 名称
- protocol: LLM API 协议, 枚举值 "anthropic" | "openai" | "openai-compat"
- base_url: 端点地址
- model: LLM 模型, 例如 claude-haiku-4-6、claude-sonnet-4-6、claude-opus-4-6
- api_key: 令牌
- thinking: 是否开启 extended thinking (可选)
- context_window: 上下文窗口大小 (可选, 默认 200_000)
- max_output_tokens: 最大输出 token 数 (可选, thinking 开启时默认 200_000, 关闭时默认 128_000)

<!-- 源码: src/config/config.ts (getMaxOutputTokens 默认值逻辑) -->
<!-- 源码: src/config/config.ts (DEFAULT_CONTEXT_WINDOW = 200_000) -->

封装层负责翻译

## 多轮对话如何实现

每一轮 LLM API 请求, 都包含完整的对话历史, 需要在客户端维护完整的消息列表, 每次用户 (CLI) 发送请求、LLM 响应, 都需要记录, token 消耗会随着对话轮次线形增长

### 消息模型

<!-- 源码: src/conversation/conversation.ts (Message 接口) -->

内部 Message 接口:

```ts
interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  thinkingBlocks?: ThinkingBlock[];
  toolUses?: ToolUseBlock[];
  toolResults?: ToolResultBlock[];
}
```

- role: user, assistant, system
- content: 消息内容
- thinkingBlocks: 可选, assistant 消息的 extended thinking 推理块 (包含 thinking 文本和 signature)
- toolUses: 可选, assistant 消息中的工具调用请求列表 (包含 toolUseId、toolName、arguments)
- toolResults: 可选, user 消息中的工具调用结果列表 (包含 toolUseId、content、isError)

内部层

- ID: `msg_<hash>` 可以根据消息 ID 定位到正在接收的 assistant 消息, 并追加 SSE chunk
- status: streaming, complete, error 封装层翻译时可以过滤 error 状态的消息
- timestamp
- usage: `{ inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens }`
- role: user, assistant, system, tool (Only for OpenAI)
- content: 消息内容 (thinking 推理、text 文本、tool_use 工具调用或其他...)

<!-- 源码: src/llm/openai.ts (buildChatCompletionMessages) -->

### 对话管理器

考虑到流式接收, CLI 正在向 assistant 消息 (SSE chunk 数组) 中追加 SSE chunk, 同时 TUI 正在读 assistant 消息 (SSE chunk 数组) 以渲染 TUI, 两处同时操作同一个列表, 可能导致数据竞争

- Node.js 单线程异步, 避免数据竞争
- Go 加锁

追加 SSE chunk 时, 拿到 assistant 消息的唯一 ID, 根据 ID 追加 SSE chunk; 更新 TUI 时, 根据 ID 拿到一份 assistant 消息的快照

## 格式转换: 内部消息到 LLM API 消息

- [Anthropic](../src/llm/anthropic.ts)
- [OpenAI](../src/llm/openai.ts)

<!-- 源码: src/llm/anthropic.ts (buildAnthropicMessages) -->

1. 转换: 内部 Message 的 thinkingBlocks、content、toolUses 转换为 LLM API 的 content block; toolResults 转换为 LLM API 的 tool_result block
2. 合并: 虽然 Claude API 可以自动合并相邻的相同 role 的消息, 但是在客户端合并是更好的做法, 消息结构更清晰, 减少 token 消耗
3. 过滤后第一条消息的 role 必须是 user, 并且 message 数组中 user 和 assistant 两个 role 交替出现

### 流式接收机制

<!-- 源码: src/llm/anthropic.ts (AnthropicClient.stream, AsyncGenerator) -->
<!-- 源码: src/llm/events.ts (StreamEvent 联合类型) -->

用户发送请求后, ConversationManager 的 stream 方法返回 `AsyncGenerator<StreamEvent>`, 每收到一个 SSE chunk, yield 对应的 StreamEvent; CLI 循环消费 AsyncGenerator, 如果是文本增量, 则提交给 UI 渲染, 如果收集到完整的工具调用 json 参数, 则调用工具; 流式接收完成后, agent 循环调用 ConversationManager 的 appendMessages 方法将消息写入对话历史
