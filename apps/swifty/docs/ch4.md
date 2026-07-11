# ReAct 和 Agent Loop

ReAct (Reasoning + Acting)

- Thinking 解释为什么要做这一步 (text)
- Act 选择调用一个工具 (tool_use)
- Observe (tool_result) 分析工具调用结果, 决定下一步怎么做

## ReAct 对比其他范式

- Chain-of-Thought 只推理, 不行动
- Act-only 只行动, 不推理
- ReAct 推理与行动交替
- Plan-then-execute 先生成完整计划, 再逐步执行

## Agent Loop

<!-- 源码: src/agent/agent.ts -->

```js
function agentLoop(userMessage) {
  const messages = [...historyMessages, userMessage];
  while (true) {
    const response = streamLLM(systemPrompt, messages, toolSchemas);
    const toolUses = response.getToolUses();
    if (toolUses.length === 0) {
      return response;
    }
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const tu of toolUses) {
      const result = executeTool(tu);
      results.push(result);
    }
    messages.push({ role: "user", content: results });
  }
}
```

## 退出 Agent Loop

<!-- 源码: src/agent/agent.ts -->

Swifty 需要 5 种 agent loop 退出条件

1. LLM 决定退出循环: LLM API 响应中没有 tool_use, stop reason 是 end_turn (Anthropic)
2. 设置最大循环次数, 超过最大循环次数后强制退出循环
3. 用户按 esc 退出循环: Go 使用 `context.Context`, TS 使用 `AbortController`
4. 如果 LLM 请求调用的工具不存在或不可用, 则返回错误结果反馈给 LLM 调整; 如果连续请求调用不存在或不可用的工具 (consecutiveUnknown >= 3), 说明 LLM 陷入幻觉, 退出循环
5. LLM output token 到达 max_tokens: 先提高 output_tokens 到 200_000, 再进行最多 3 轮的多轮恢复, 每轮恢复提示 LLM 从断点继续; 恢复耗尽则降级为正常结束 (TODO: 表述待确认)

## AgentEvent 事件流

agent loop 期间会发射大量事件:

- stream_text: LLM 流式输出的文本增量
- thinking_text: LLM 推理的文本增量
- thinking_complete: 完整的推理块, 包含 thinking 和 signature
- tool_use: LLM 请求调用工具
- tool_result: LLM 工具调用结束
- turn_complete: 一轮 LLM 调用结束 (LLM 请求调用工具 + CLI 工具调用结束)
- loop_complete: 整个 agent loop 结束, stop reason 可以是 end_turn 或 interrupted
- usage: token 用量更新
- compact: 上下文压缩完成
- retry: 自动重试 (output token 到达 max_tokens 恢复或限流等待)
- error: 发生错误

UI 层只需要从 AgentEvent 事件流中消费事件, 根据事件更新 UI, agent 和 UI 解构; Go 使用 channel, TS 使用 AsyncGenerator (`async function* + yield`)

## 状态机

LLM 响应后, 只有两种可能: 继续循环 / 退出循环

```js
function classifyResponse(response) {
  const toolUses = response.getToolUses();
  if (toolUses.length > 0) {
    return "continue";
  }
  return "terminal";
}
```

## 执行工具

按工具的 isConcurrencySafe 分 batch, 并发安全的并发执行, 并发不安全的串行执行; 并发 batch 可以包含多个并发安全的工具调用, 串行 batch 只能包含一个并发不安全的工具调用

```js
/**
 * e.g. LLM returns [Read, Read, Edit, Read, Read]
 *
 * Batches:
 *   [Read, Read]
 *   [Edit]
 *   [Read, Read]
 */
function partitionToolCalls(toolUses, registry) {
  const batches = [];
  for (const tu of toolUses) {
    const tool = registry.get(tu.name);
    const safe = tool?.isConcurrencySafe(tu.input) ?? false;

    if (safe && batches.length > 0) {
      const lastBatch = batches[batches.length - 1];
      lastBatch.calls.push(tu);
    } else {
      batches.push(
        new Batch({
          isConcurrencySafe: safe,
          calls: [tu],
        }),
      );
    }
  }
  return batches;
}
```

## System Prompt 与环境信息

每轮 agent loop turn 都需要发送 System Prompt 给 LLM API, System Prompt 包含用户信息、环境信息 (操作系统、工作目录) 和模式指令 (planMode)

## Plan Mode 只规划不做事

通过 prompt 约束 LLM 行为, plan mode 的权限矩阵和 default mode 相同: read=allow, write=ask, command=ask, 特殊的是 plan.md 的 write=allow, 不需要用户确认
