// These two tools are exposed or not depending on the mode; the registry filters
// by name, so the names are defined here centrally, to avoid the registry reverse-
// importing the concrete implementations and creating a circular dependency.
export const TOOL_SEARCH_TOOL_NAME = "ToolSearch";
export const MCP_CALL_TOOL_NAME = "McpCall";
