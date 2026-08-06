/**
 * MCP 工具的统一调用入口。
 *
 * MCP 工具不进入 tools[]，模型先用 ToolSearch 读到 schema，再通过 mcp_call
 * 把工具名和参数传进来。这样 tools 数组在整场会话里字节不变，prompt cache
 * 的前缀不会被打断——工具排在 system 之后、messages 之前，数组一变，它后面
 * 的整段历史都要重算。
 *
 * 代价是参数由模型自由生成，没有接口层的 schema 约束，偶尔会写错 JSON 类型。
 * coerceBySchema 按目标工具的完整 schema 逐层修正，修正规则四个语言必须逐条
 * 一致：
 *
 *   schema 声明        模型给的                修正为
 *   string            数字（非 boolean）       "8891"
 *   integer / number  数字形字符串             5 / 5.0
 *   boolean           "true" / "false"        true / false
 *   array             单键对象且值是数组        拆出内层数组
 *   array             逗号分隔字符串           按逗号切分去空白
 *   object            对象                     按 properties 递归
 *   array             数组                     按 items 递归每个元素
 *
 * 修正不了的原样往下传，交给 MCP 服务器报它自己的错——服务器的域内错误比本地
 * 类型错误对模型更有指导性。
 */

import {
  MCP_NAME_SEP,
  MCP_TOOL_PREFIX,
  buildMcpToolName,
  sanitizeSegment,
} from "../mcp/tool-wrapper.js";

import type { ToolRegistry } from "./registry.js";
import { MCP_CALL_TOOL_NAME } from "./tool-names.js";
import type { MCPToolLike, Tool, ToolContext, ToolResult, ToolSchema } from "./types.js";

import { asRecord, strArg } from "@/utils/index.js";

/** 分发工具的名字，权限规则里也用它。 */
export { MCP_CALL_TOOL_NAME } from "./tool-names.js";

function coerceScalar(value: unknown, want: string): unknown {
  // boolean 是要先排掉的：typeof true !== "number"，但别的语言里 bool 是 int
  // 的子类，四个语言统一按「boolean 不参与数字转换」处理
  if (want === "string" && typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if ((want === "integer" || want === "number") && typeof value === "string") {
    const text = value.trim();
    if (text === "") {
      return value;
    }
    // 只有整串都是数字才接受，"5abc" 这种不动；integer 还要求没有小数部分，
    // "5.7" 不做截断，原样交给 MCP 服务器报它的域内错误
    const shape = want === "integer" ? /^[+-]?\d+$/ : /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
    if (!shape.test(text)) {
      return value;
    }
    const parsed = want === "integer" ? Number.parseInt(text, 10) : Number.parseFloat(text);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (want === "boolean" && typeof value === "string") {
    const low = value.trim().toLowerCase();
    if (low === "true") {
      return true;
    }
    if (low === "false") {
      return false;
    }
  }
  return value;
}

export function coerceBySchema(value: unknown, schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) {
    return value;
  }
  const schemaObj = asRecord(schema);
  const want = strArg(schemaObj, "type", "");

  if (want === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const props = asRecord(schemaObj.properties ?? {});
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = key in props ? coerceBySchema(item, props[key]) : item;
    }
    return out;
  }

  if (want === "array") {
    const itemSchema = schemaObj.items ?? {};
    let working: unknown = value;
    // 模型常把数组包成 {"item": [...]} 这类单键对象
    if (typeof working === "object" && working !== null && !Array.isArray(working)) {
      const entries = Object.values(working);
      if (entries.length === 1 && Array.isArray(entries[0])) {
        working = entries[0];
      }
    } else if (typeof working === "string") {
      // 也常拼成逗号分隔的字符串
      working = working
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p !== "");
    }
    if (Array.isArray(working)) {
      return working.map((item) => coerceBySchema(item, itemSchema));
    }
    return working;
  }

  if (want !== "") {
    return coerceScalar(value, want);
  }
  return value;
}

/**
 * 权限规则匹配用的 content，归一化成 server__tool。
 *
 * 不带 mcp__ 前缀，也不受各语言 wrapper 命名差异影响，四个语言的
 * permissions.yaml 写法因此完全一致：mcp_call(linear__create_issue)。
 *
 * 两段都要过一遍 sanitize。模型可能传短名也可能传全名，全名里的段是 wrapper
 * 已经处理过的，短名是模型原样给的——不统一处理的话，同一个调用传短名和传全名
 * 会算出不同的 content，规则就会漏匹配。
 */
export function mcpCallPermissionContent(server: string, tool: string): string {
  if (tool.startsWith(MCP_TOOL_PREFIX)) {
    const rest = tool.slice(MCP_TOOL_PREFIX.length);
    const idx = rest.indexOf(MCP_NAME_SEP);
    if (idx >= 0) {
      // 全名里已经带了服务器段，用它，避免拼出 linear__linear__x
      return (
        sanitizeSegment(rest.slice(0, idx)) +
        MCP_NAME_SEP +
        sanitizeSegment(rest.slice(idx + MCP_NAME_SEP.length))
      );
    }
  }
  return sanitizeSegment(server) + MCP_NAME_SEP + sanitizeSegment(tool);
}

export function isMcpToolLike(tool: Tool): tool is MCPToolLike {
  return "mcpInputSchema" in tool && typeof tool.mcpInputSchema === "function";
}

export class McpCallTool implements Tool {
  name = MCP_CALL_TOOL_NAME;
  description =
    "Invoke a tool on a connected MCP server. Call ToolSearch first to load the " +
    "tool's schema, then pass its arguments here exactly as that schema requires, " +
    "using the same JSON types.";
  category = "command" as const;
  // 自己必须留在 tools[] 里，否则模型没有入口
  deferred = false;

  constructor(private registry: ToolRegistry) {}

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          server: { type: "string", description: "MCP server name, e.g. 'linear'." },
          tool: {
            type: "string",
            description:
              "Full tool name as returned by ToolSearch, e.g. 'mcp__linear__create_issue'.",
          },
          arguments: {
            type: "object",
            description:
              "The target tool's arguments. Must match that tool's input_schema " +
              "exactly, including JSON types: bare numbers for integer fields, bare " +
              "true/false for boolean fields, quoted strings for string fields, and " +
              "plain JSON arrays for array fields.",
          },
        },
        required: ["server", "tool", "arguments"],
      },
    };
  }

  /**
   * 全名 / server+短名 / 短名后缀唯一匹配，依次尝试。
   *
   * 模型很常只传短名（实测约三成调用），所以这里必须容错，否则会白白换来
   * 一轮重试。
   */
  private resolve(server: string, tool: string): Tool | undefined {
    const direct = this.registry.get(tool) ?? this.registry.get(buildMcpToolName(server, tool));
    if (direct) {
      return direct;
    }

    const suffix = MCP_NAME_SEP + sanitizeSegment(tool);
    const matches = this.registry
      .listTools()
      .filter((t) => t.name.startsWith(MCP_TOOL_PREFIX) && t.name.endsWith(suffix));
    return matches.length === 1 ? matches[0] : undefined;
  }

  private availableNames(): string[] {
    return this.registry
      .listTools()
      .filter((t) => t.name.startsWith(MCP_TOOL_PREFIX))
      .map((t) => t.name)
      .sort();
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const server = strArg(args, "server", "");
    const tool = strArg(args, "tool", "");
    if (tool === "") {
      return { output: "mcp_call requires a 'tool' name", isError: true };
    }

    const target = this.resolve(server, tool);
    if (!target) {
      const names = this.availableNames();
      const hint = names.length > 0 ? names.join(", ") : "(none connected)";
      return {
        output: `Unknown MCP tool '${tool}' on server '${server}'. Available tools: ${hint}`,
        isError: true,
      };
    }

    let inner: Record<string, unknown> = {};
    if (
      typeof args.arguments === "object" &&
      args.arguments !== null &&
      !Array.isArray(args.arguments)
    ) {
      inner = asRecord(args.arguments);
    }

    if (isMcpToolLike(target)) {
      const schema = target.mcpInputSchema();
      if (Object.keys(schema).length > 0) {
        const fixed = coerceBySchema(inner, schema);
        if (typeof fixed === "object" && fixed !== null && !Array.isArray(fixed)) {
          inner = asRecord(fixed);
        }
      }
    }

    return target.execute(ctx, inner);
  }
}
