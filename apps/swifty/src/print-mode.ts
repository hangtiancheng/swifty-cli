import { loadConfig } from "./config/config.js";
import { getContextWindow, getMaxOutputTokens } from "./config/config.js";
import { createClient } from "./llm/client.js";
import { ConversationManager } from "./conversation/conversation.js";
import { buildSystemPrompt, detectEnvironment } from "./prompt/builder.js";
import { ToolRegistry } from "./tools/registry.js";
import { ReadFileTool } from "./tools/read-file.js";
import { BashTool } from "./tools/bash.js";
import { GlobTool } from "./tools/glob.js";
import { GrepTool } from "./tools/grep.js";
import { WriteFileTool } from "./tools/write-file.js";
import { EditFileTool } from "./tools/edit-file.js";
import { ToolSearchTool } from "./tools/tool-search.js";
import { PermissionChecker } from "./permissions/checker.js";
import { Agent } from "./agent/agent.js";
import type { AgentEvent } from "./agent/events.js";
import { FileStateCache } from "./tools/file-state-cache.js";

/** Supported output formats for -p (print) mode. */
type OutputFormat = "text" | "stream-json";

/** Parsed arguments for -p mode. */
export interface PrintArgs {
  prompt: string;
  outputFormat: OutputFormat;
}

/**
 * Parses -p related command-line flags.
 * Returns null when -p mode is not active.
 */
export function parsePrintFlags(args: string[]): PrintArgs | null {
  const idx = args.indexOf("-p");
  if (idx === -1) {
    return null;
  }

  const prompt = args[idx + 1];
  if (!prompt) {
    console.error("Error: -p requires a prompt argument");
    process.exit(1);
  }

  // Parse --output-format (defaults to "text")
  let outputFormat: OutputFormat = "text";
  const fmtIdx = args.indexOf("--output-format");
  if (fmtIdx !== -1 && args[fmtIdx + 1]) {
    const fmt = args[fmtIdx + 1];
    if (fmt === "stream-json") {
      outputFormat = "stream-json";
    } else if (fmt !== "text") {
      console.error(`Error: unknown output format '${fmt}', expected 'text' or 'stream-json'`);
      process.exit(1);
    }
  }

  return { prompt, outputFormat };
}

/**
 * Runs the Agent non-interactively and writes the result to stdout.
 * - text mode: emits only the model's text response
 * - stream-json mode: emits one JSON line per event
 */
export async function runPrintMode(args: PrintArgs): Promise<void> {
  const startTime = Date.now();
  const workDir = process.cwd();

  // Load configuration
  const cfg = loadConfig();
  const provider = cfg.providers[0];

  // Build system prompt
  const env = detectEnvironment(workDir);
  env.model = provider.model;
  const systemPrompt = buildSystemPrompt(env);

  // Create LLM client
  const client = await createClient(provider, systemPrompt);

  // Create tool registry and register core tools
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new BashTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new ToolSearchTool(registry));

  // Create conversation manager and add user message
  const conv = new ConversationManager();
  conv.addUserMessage(args.prompt);

  // bypassPermissions mode: auto-approve all permission requests
  const checker = new PermissionChecker(workDir, "bypassPermissions");

  // Create Agent
  const agent = new Agent({
    client,
    registry,
    checker,
    conversation: conv,
    workDir,
    fileStateCache: new FileStateCache(),
    contextWindow: getContextWindow(provider),
    maxOutput: getMaxOutputTokens(provider),
  });

  // Statistics
  let resultText = "";
  let numTurns = 0;
  const toolCalls: { tool: string; elapsed: number }[] = [];
  const totalUsage = { inputTokens: 0, outputTokens: 0 };

  // Consume the Agent event stream
  for await (const event of agent.run()) {
    if (args.outputFormat === "stream-json") {
      emitStreamJson(event);
    } else {
      // text mode: emit only streamed text
      if (event.type === "stream_text") {
        process.stdout.write(event.text);
      }
    }

    // Collect statistics
    switch (event.type) {
      case "stream_text":
        resultText += event.text;
        break;
      case "tool_use":
        toolCalls.push({ tool: event.toolName, elapsed: 0 });
        break;
      case "tool_result":
        // Update elapsed time for the most recent matching tool call
        for (let i = toolCalls.length - 1; i >= 0; i--) {
          if (toolCalls[i].tool === event.toolName && toolCalls[i].elapsed === 0) {
            toolCalls[i].elapsed = event.elapsed;
            break;
          }
        }
        break;
      case "turn_complete":
        numTurns++;
        break;
      case "usage":
        totalUsage.inputTokens += event.usage.inputTokens;
        totalUsage.outputTokens += event.usage.outputTokens;
        break;
      case "error":
        if (args.outputFormat === "text") {
          console.error(`\nError: ${event.error.message}`);
        }
        break;
    }
  }

  const durationMs = Date.now() - startTime;

  // text mode: ensure trailing newline
  if (args.outputFormat === "text" && resultText && !resultText.endsWith("\n")) {
    process.stdout.write("\n");
  }

  // stream-json mode: emit final summary
  if (args.outputFormat === "stream-json") {
    const resultLine = {
      type: "result",
      result: resultText,
      duration_ms: durationMs,
      num_turns: numTurns,
      tool_calls: toolCalls,
      usage: totalUsage,
    };
    console.log(JSON.stringify(resultLine));
  }
}

/**
 * Emits an Agent event as a single JSON line to stdout (stream-json format).
 */
function emitStreamJson(event: AgentEvent): void {
  switch (event.type) {
    case "tool_use":
      console.log(
        JSON.stringify({
          type: "tool_use",
          tool_name: event.toolName,
          tool_id: event.toolId,
          args: event.args,
        }),
      );
      break;

    case "tool_result":
      console.log(
        JSON.stringify({
          type: "tool_result",
          tool_name: event.toolName,
          output: event.output,
          is_error: event.isError,
          elapsed: event.elapsed,
        }),
      );
      break;

    case "usage":
      console.log(
        JSON.stringify({
          type: "usage",
          input_tokens: event.usage.inputTokens,
          output_tokens: event.usage.outputTokens,
        }),
      );
      break;

    case "error":
      console.log(
        JSON.stringify({
          type: "error",
          message: event.error.message,
        }),
      );
      break;

    // stream_text, thinking_text, etc. are not emitted in stream-json mode
    // (text content is aggregated into the final result summary)
    default:
      break;
  }
}
