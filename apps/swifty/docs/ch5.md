---
title: "System Prompt"
description: "System Prompt"
sidebar_position: 4
---

# System Prompt 和权限

## System Prompt

System Prompt 分为 7 个模块

- Agent 的角色
- 行为准则
- 工具调用指南
- 代码质量规范
- 安全边界
- 任务执行模式
- 输出风格

## Prompt 的 7 个来源、3 个字段

### 7 个来源

| 来源                                         | 字段     | 原因                                          |
| -------------------------------------------- | -------- | --------------------------------------------- |
| System Prompt                                | system   | 始终生效, 内容稳定可以缓存                    |
| 环境上下文: 操作系统、工作目录...            | system   | 每个 session 确定后不再改变, 可以缓存         |
| 工具描述: 工具的 description, input_schema   | tools    | LLM API 规范                                  |
| 项目指令文件: AGENTS.md (LARKY.md)           | messages | 内容可能很长, 放在 system 可能稀释 LLM 注意力 |
| 自动记忆: Agent 自动沉淀的用户偏好和项目知识 | messages | 内容可能变化态                                |
| System Reminder: 动态注入的上下文            | messages | 特定时机注入                                  |
| 对话历史                                     | messages | LLM API 规范                                  |

> system 字段的优先级最高, 为什么不都设置为 system 字段?

1. prompt cache, LLM API 支持 prompt cache, 如果 system 字段的值和上一次请求完全相同, 则 LLM API 会复用缓存, 降低 input token 的计费; system prompt 内容稳定, 每次请求都可以命中缓存
   - 稳定的内容放在 system 字段、变化的内容放在 messages 字段
   - AGENTS.md (LARKY.md) 和自动记忆放在 system 字段, 会频繁使得 prompt cache 缓存失效
   - 环境上下文每个 session 不同, 但是一个 session 中是稳定的, 可以使用分层缓存: 全局缓存、会画级缓存
2. system 字段内容太长, 可能会稀释 LLM 注意力
3. 可压缩性: messages 字段的内容, 后续可以被上下文压缩处理; 但是 system 字段的内容不会被压缩, 每次发送 LLM 请求时都会完整携带; 如果 AGENTS.md 的内容后期不再需要, /compact 可以压缩或删除, 但是 system 字段的内容不会被上下文压缩处理, 每次请求都会完整携带

```js
function assembleAPIPayload(config, conversationHistory) {
  // system 字段: 稳定的 system prompt + 会话级上下文
  const system = buildSystemPrompt(config);

  // 环境上下文也放到 system 字段, 使用缓存分层管理
  const envContext = buildEnvironmentContext(config);
  system += "\n\n" + envContext;

  // message 字段: 存放变化的内容
  const messages = [];

  // 项目指令文件 (AGENTS.md, CLAUDE.md, LARKY.md)
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

工具描述不是注释, 是 prompt 的一部分; 模型根据 description 做决策: 什么时候调用这个工具, 如何调用这个工具; 好的工具描述和 system prompt 的「工具调用指南」有重叠, 例如优先 ReadFile 而不是 bash、cat; 重复说明, 模型遵守的概率会更高

### 动态指令注入: `<system-reminder>`

#### 信息的来源

- system prompt: 会话开始时确定
- 会话历史: 随会话产生
- 会话过程中产生, 需要立刻让模型知道: 例如会话过程中华, 用户通过配置连接了一个 MCP Server, 这个 MCP Server 提供了多个新工具, Agent 需要立刻知道这些工具的描述; 但是不能修改 system prompt, 修改 system prompt 会使得 prompt cache 失效; 但也不能作为用户消息, 否则模型可能会回复

#### 什么是 `<system-reminder>`

`<system-reminder>` 是一种特殊的消息标记, 放在 messages 字段中, 以告诉模型这是补充的 system prompt

1. 训练阶段, 模型理解「xml 标签间的内容是一块有语义的单元」
2. 微调/RLHF 阶段

- Anthropic 在微调时使用 `<system-reminder>`
- OpenAI 在 tokenizer 时使用 `<|im_start|>system<|im_end|>`
- OpenAI Codex: 使用 `<environment_context>`, `<INSTRUCTIONS>`, `<objective>`

模型看到 `<system-reminder>`, 就知道标签间的内容是当指令对待, 而不是当用户消息对待; 不回复这段内容, 而是加入自己的工作上下文

#### 典型使用场景

- MCP Server 上线或下线
- 可用 skill 列表重新
- Agent 配置更新
- 温和提醒
- AGENTS.md / CLAUDE.md / LARKY.md 内容注入

#### 为什么不能直接改 system prompt

1. 改 system prompt 会让 prompt cache 失效
2. prompt cache 按前缀匹配, 顺序是 tools -> system -> messages, 直接改 system prompt 会导致后面的 message 的缓存全部失效
3. `<system-reminder>` 和用户消息需要作为独立的 content block, 不能拼在一起; 如果 `<system-reminder>` 的内容包含外部文本, 需要预防 prompt 注入

## Pitfall: Prompt 太长, 中间指令被忽略

## Prompt 与成本

## 权限

### 三种攻击

- prompt 注入
- 越权
- 数据泄露

### 多层防御

1. 危险命令拦截, 例如 rm -rf /
2. 路径沙箱: 工作目录外的文件操作需要用户确认
   - 计算绝对路径
   - 解析符号链接
   - 检查是否在工作目录内
3. 权限规则
4. 权限模式
   - plan 读放行, 写确认, 通过 prompt 约束 LLM 行为, 使得 LLM 只读
   - default 读放行, 写确认
   - acceptEdits 读写放行, Bash 命令需要确认
   - bypassPermissions 绕过权限, 但是仍然拦截 rm -rf / 等危险命令
5. HITL (Human-in-the-Loop): 人在回路, 用户确认

```jsonl
// 权限规则 (json)
{
  "permissions": {
    "allow": ["Bash(pnpm add *)", "Bash(pnpm dev)"]
  }
}

// 权限模式 (json)
{
  "permissions": {
    "defaultMode": "auto"
  },
}
```

- 本地规则 .swifty/permissions.local.yaml
- 项目规则 .swifty/permission.yaml
- 全局规则 ~/.swifty/permission.yaml

```yaml
# 权限规则 (yaml)
- rule: Bash(git *)
  effect: allow

- rule: Bash(git push --force*)
  effect: deny

- rule: ReadFile(/path/to/project/src/*)
  effect: allow

- rule: ReadFile(*.env*)
  effect: deny

- rule: EditFile(*.ts)
  effect: allow
```

```js
function evaluateRules(toolName, content) {
  for (const ruleSet of [localRules, projectRules, userRoles]) {
    for (const rule of ruleSet) {
      if (rule.match(toolName, pattern) && rule.effect === "DENY") {
        return "DENY";
      }
    }
  }

  // 从高优先级到低优先级查找 allow
  for (const ruleSet of [localRules, projectRules, userRoles]) {
    for (const rule of ruleSet.reverse()) {
      if (rule.match(toolName, pattern) && rule.effect === "ALLOW") {
        return "ALLOW";
      }
    }
  }

  return "UNKNOWN";
}
```
