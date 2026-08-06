// 这两个工具是「按模式发不发」的，注册表按名字筛，名字集中在这里定义，
// 免得注册表反向 import 具体实现造成循环依赖。
export const TOOL_SEARCH_TOOL_NAME = "ToolSearch";
export const MCP_CALL_TOOL_NAME = "McpCall";
