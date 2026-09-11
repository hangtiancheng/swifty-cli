import { strArg } from "@/utils/index.js";

export {
  buildComposedToolFilter,
  countMcpTools,
  createToolRegistry,
  wireSkillsToRegistry,
} from "./tool-registry.js";

export function formatToolArgs(args: Record<string, unknown>): string {
  if (args.command) {
    return truncate(strArg(args, "command"), 80);
  }
  if (args.file_path) {
    return truncate(strArg(args, "file_path"), 80);
  }
  if (args.pattern) {
    return truncate(strArg(args, "pattern"), 80);
  }
  return "";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
