# MCP

## 背景

Tool 的接入和 Agent CLI 是耦合的

MCP: 动态接入 Tools

## MCP

MCP (Model Context Protocol) 是一个开放协议, 定义 AI 应用 (MCP 客户端) 和外部 Tools Server (MCP 服务器) 的标准化通信方式

### 角色

- Host: AI 应用, 例如 Claude Code、Claude Desktop、Codex、Swifty
- Client: Host 的 MCP 连接组件, 负责和 MCP Server 建立连接, 发送请求, 接收响应
- Server: 外部 Tools 提供方

Swifty 这个 Host 会创建一个或多个 MCP Client, 每个 Client 对应一个 MCP Server

### 协议分层

- Data Layer 数据层: 定义消息格式、初始化握手、工具发现/工具调用, 核心是 JSON-RPC 2.0, lifecycle, tools, resources, prompts 等原语 (primitives)
- Transport Layer 传输层: 使用 stdio 还是 streamable http

```ts
type MCPTransport =
  | StdioClientTransport
  | StreamableHTTPClientTransport
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  | SSEClientTransport;
```

<!-- 源码: src/mcp/client.ts -->

- tools: 一个 MCP Server 可以暴露一组工具, 每个工具有 name, description, input_schema, required
- resources: 可读的数据源, 例如数据库 MCP Server 可以暴露表结构最为 resources
- prompts: MCP Server 提供的预定义提示词模版函数 (prompt 字符串插值)

tools

```json
{
  "name": "search_issues",
  "description": "Search github issues",
  "inputSchema": {
    "type": "object",
    "properties": {
      "repo": {
        "type": "string",
        "description": "Repository name, format: owner/repo"
      },
      "query": {
        "type": "string",
        "description": "Search keyword"
      },
      "state": {
        "type": "string",
        "enum": ["all", "open", "closed"]
      }
    },
    "required": ["repo"]
  }
}
```

resources

```json
{
  "uri": "db://root:pass@127.0.0.1:5432/fe26/schema",
  "name": "database table schema",
  "mimeType": "application/json"
}
```

prompts

```json
{
  "name": "generate_query",
  "description": "Generate sql query from natural language",
  "arguments": [
    {
      "name": "table",
      "description": "Table name"
    },
    {
      "name": "intent",
      "description": "Natural language description of query intent"
    }
  ]
}
```

MCP Client 可以声明

- roots: 项目根目录, 或者工作区边界
- sampling: 允许 MCP Server 反过来请求 Host 调用 LLM
- elicitation: 允许 MCP Server 请求 Host, 向用户提问

## stdio / streamable http

- stdio: Host 中的 MCP Client 将 MCP Server 作为子进程启动, Host 中的 MCP Client 通过 stdin/stdout 管道和 MCP Server 进行通信, MCP Server 在本机, 可以访问远程服务
  - 不需要: 监听端口、网络连接、服务发现、身份认证
  - stdio 的消息格式是 UTF-8 编码的 JSON-RPC 消息, 以换行符分隔
  - stderr 不参与通信, 用于输出调试日志
- streamable http: MCP Server 是一个独立的 HTTP 服务器, Host 中的 MCP Client 通过 HTTP post/get 和 MCP Server 进行通信, 必要时使用 SSE 流式传输; MCP Server 可以在本机, 也可以在远程
  - Host 中的 MCP Client 使用 HTTP post 将 JSON-RPC 消息发送到 MCP Server 的 endpoint
  - MCP Server 有两种响应方式
    1. 如果结果已 ready, 则直接返回 application/json 响应
    2. 如果结果未 ready, 需要流式传输, 则返回 text/event-stream 响应, 使用 SSE 推送结果
  - MCP Client 发送请求时, Accept 头必须同时声明 `Accept: application/json, text/event-stream`

```yaml
mcp_servers:
  # stdio: command 字段 -> 启动子进程
  github:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"],
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"

  # streamable http: url 字段 -> 发送 http 请求
  remote-tool:
    url: "https://api.example.com/mcp",
    headers:
      Authorization: "Bearer ${API_TOKEN}"
```

## JSON-RPC 2.0

不管是使用 stdio 还是 streamable http, MCP 的消息格式统一使用 JSON-RPC 2.0

JSON-RPC 2.0 只有 3 种消息类型

### 请求 (Request)

字段: id, method, params

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_issues",
    "arguments": {
      "repo": "golang/go",
      "query": "error handling"
    }
  }
}
```

### 响应 (Response)

字段: id (响应 id 和请求 id 对应), result 或 error

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Found 233 issues matching 'error handling'..."
      }
    ]
  }
}
```

### 通知 (Notification)

字段: method, params

通知和请求的区别是: 通知没有 id, 不期望响应; 请求有 id, 期望响应

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "abc",
    "progress": 0.5,
    "total": 1.0
  }
}
```

## 完整的 MCP 会话

以 stdio 为例

### 1. 初始化握手

Host 中的 MCP Client 将 MCP Server 作为子进程启动后, 发送 `initialize` 请求, 声明自己的协议版本、能力和身份信息; MCP Server 响应自己的协议版本、能力和身份信息

握手成功后, MCP Client 发送 `notifications/initialized` 通知

如果底层 transport 不是 stdio 而是 streamable http, 则后续 http 请求还需要携带 `MCP-Protocol-Version` http 头部字段

MCP Client

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    // MCP Client 声明自己的 protocolVersion 协议版本、capabilities 能力和 clientInfo 身份信息
    "protocolVersion": "2025-11-25",
    "capabilities": { "roots": {} },
    "clientInfo": { "name": "swifty", "version": "0.0.1" }
  }
}
```

MCP Server

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    // MCP Server 响应自己的 protocolVersion 协议版本、capabilities 能力和 serverInfo 身份信息
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "tools": {},
      "resources": {}
    },
    "serverInfo": { "name": "github-mcp", "version": "0.0.1" }
  }
}
```

### 2. 工具发现

- MCP Client 发送 `tools/list` 请求, 获取 MCP Server 提供的所有工具定义
- MCP Server 响应自己提供的所有工具定义
- MCP Client 将 MCP Server 响应的工具定义包装为 Swifty 内部的 Tool 接口 (MCPToolWrapper, 适配器模式), 注册到 ToolRegistry; 下一轮对话, LLM 在工具列表中就能看到这些工具, 决定是否调用 <!-- 源码: src/mcp/tool-wrapper.ts -->

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "search_issues",
        "description": "Search github issues",
        "inputSchema": {}
      },
      {
        "name": "create_issue",
        "description": "Create github issue",
        "inputSchema": {}
      }
    ]
  }
}
```

### 3. 工具调用

当 LLM 决定调用某个 MCP 工具时, MCP Client 发送 `tools/call` 请求

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_issues",
    "arguments": {
      "repo": "golang/go",
      "query": "error handling"
    }
  }
}
```

MCP Server 调用工具后响应工具调用结果, 返回的 content 是一个数组, 每个元素是一个内容块 (content block), 可以是文本、图片等

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Found 233 issues matching 'error handling'..."
      }
    ]
  }
}
```

> 整个流程是: initialize (client request, server response) -> notifications/initialized (client notification) -> tools/list (client request, server response) -> tools/call \* N

## MCP 配置

- 项目级配置 .swifty.yaml, 当前项目生效
- 用户级配置 ~/.swifty/config.yaml, 所有项目生效

```yaml
# 项目级配置 .swifty.yaml, 当前项目生效
# 用户级配置 ~/.swifty/config.yaml, 所有项目生效
mcp_servers:
  # stdio: command 字段 -> 启动子进程
  github:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"],
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"

  database:
    command: "python"
    args: ["-m", "mcp_server_sqlite", "--db", "./data.db"]
```

## 完整流程: 从配置到调用

1. 启动: 读取配置文件, 获取 MCP Server 列表
2. 选择 transport: 根据 MCP Server 配置选择 stdio 或 streamable http
3. 后台 (goroutine) 异步连接: 启动时, 后台异步连接所有配置的 MCP Server
4. 初始化 (JSON-RPC 2.0)

- MCP Client 发送 `initialize` 请求, MCP Server 响应
- MCP Client 发送 `notifications/initialized` 通知

5. 工具发现: MCP Client 发送 `tools/list` 请求, MCP Server 响应, 获取工具定义
6. 工具注册: MCP Client 将 MCP Server 响应的工具定义包装为 CLI 内部的 Tool 接口: MCPToolWrapper (适配器模式), 注册到 ToolRegistry; 工具 name 使用 `mcp__serverName__toolName` 格式, 默认 `deferred = true`, `category = "command"` <!-- 源码: src/mcp/tool-wrapper.ts -->
7. LLM 调用: 下一轮对话, LLM 在工具列表中看到这些工具, 决定是否调用
8. 工具调用: LLM 调用工具, MCP Client 发送 `tools/call` 请求
9. 返回工具调用结果: MCP Server 返回工具调用结果

## 工具延迟加载: 80 个工具塞不进上下文

如果用户配置了 4 个 MCP Server, 每个 MCP Server 提供 15-20 个工具, 加上 Swifty 的 6 个内置工具, 工具数量膨胀到 80 个; 每个工具定义包含 name, description, input_schema, 大约 100-300 个 token, 80 个工具定义就是 8000-24000 个 token, 每轮对话都需要携带, 占用大量的上下文窗口, 也影响 LLM 的工具选择准确率

开启工具延迟加载后, 可以降低 token 消耗、提高 LLM 的工具选择准确率

### 延迟加载

1. 注册 MCP Server 提供的工具时, 标记延迟加载 `deferred: true`
2. 每个 agent loop (注意: 不是每轮 agent loop turn) 构建工具列表时, 跳过延迟加载的工具, 即工具列表中不包括延迟加载的工具定义, 仅在 `<system-reminder />` 中列出延迟加载的工具名称
3. LLM 在 `<system-reminder />` 中看到延迟加载的工具名称列表, 判断需要调用某个工具时, 先调用 ToolSearch 工具拉取该工具的完整定义
4. ToolSearch 工具在 CLI 客户端的 ToolRegistry 中找到该工具, 返回该工具的完整定义, 标记为 discovered, 从下一个 agent loop 开始, 构建的工具列表中就会包括该工具的完整定义 (tools 字段)

```js
// @/tools/registry.ts
// ToolRegistry.prototype.getAllSchemas
// ToolRegistry.prototype.getDeferredToolNames

function buildToolList(registry, addSystemReminder) {
  // getAllSchemas 过滤 deferred && !discovered 的工具
  const toolList = registry.getAllSchemas();

  // getDeferredToolNames 返回所有延迟加载的工具 names
  const deferredNames = registry.getDeferredToolNames();

  if (deferredNames.length > 0) {
    addSystemReminder(
      `The following tools can be loaded by calling the ToolSearch tool:\n${deferredNames.join("\n")}`,
    );
  }
  return toolList;
}

// @/tools/tool-search.ts
// ToolSearchTool.prototype.execute
// 支持 2 种 Tool 搜索方式:
// 1. "select:name1,name2" 按工具 name 精确搜索
// 2. 关键词模糊匹配
function toolSearchExecute(query, registry, maxResults = 5) {
  let tools = [];

  if (query.startsWith("select:")) {
    // 按工具 name 精确搜索
    const names = query
      .slice("select:".length)
      .split(",")
      .map((n) => n.trim());
    tools = registry.findDeferredByNames(names);
  } else {
    // 关键词模糊匹配
    tools = registry.searchDeferred(query, maxResults);
  }

  for (const tool of tools) {
    registry.markDiscovered(tool.name);
  }

  const schemas = tools.map((t) => JSON.stringify(t.schema(), null, 2));
  return schemas.join("\n\n");
}
```

### 延迟加载策略

- 6 个内置工具: `deferred: false`
- MCP Server 提供的工具: `deferred: true`, 延迟加载; MCPToolWrapper 默认 `category = "command"`, `deferred = true` <!-- 源码: src/mcp/tool-wrapper.ts -->

## 工具权限

按工具名称匹配权限规则

MCP 工具命名规范: `mcp__serverName__toolName`

<!-- 源码: src/mcp/tool-wrapper.ts -->

sanitizeName 函数将 serverName 和 toolName 中的非字母数字字符替换为下划线, 并使用 `mcp__` 前缀和双下划线连接

```js
function sanitizeName(serverName: string, toolName: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, "_");
  return `mcp__${clean(serverName)}__${clean(toolName)}`;
}
```

<!-- 源码: src/mcp/tool-wrapper.ts -->

MCPToolWrapper 默认配置:

- category: "command"
- deferred: true

```yaml
# 允许 GitHub MCP 工具
- rule: mcp__github__*(*)
  effect: allow

# 禁止所有 MCP 工具的删除操作
- rule: mcp__*__delete__*(*)
  effect: deny
```
