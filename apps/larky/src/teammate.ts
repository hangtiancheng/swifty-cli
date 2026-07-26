/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { loadConfig } from "./config/config.js";
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
import { PermissionChecker } from "./permissions/checker.js";
import { Agent } from "./agent/agent.js";
import { FileStateCache } from "./tools/file-state-cache.js";
import type { FileMailMessage } from "./teams/file-mailbox.js";
import { FileMailbox } from "./teams/file-mailbox.js";
import { initLogger, closeLogger, createChildLogger, sanitizeNameSegment } from "./logger/index.js";

interface TeammateArgs {
  teamDir: string;
  memberName: string;
  initialTask: string;
  providerName?: string;
}

export function parseTeammateFlags(args: string[]): TeammateArgs | null {
  if (!args.includes("--teammate")) {
    return null;
  }

  let teamDir = "";
  let memberName = "";
  let initialTask = "";
  let providerName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--team-dir" && args[i + 1]) {
      teamDir = args[++i];
    }
    if (args[i] === "--member-name" && args[i + 1]) {
      memberName = args[++i];
    }
    if (args[i] === "--task" && args[i + 1]) {
      initialTask = args[++i];
    }
    if (args[i] === "--provider" && args[i + 1]) {
      providerName = args[++i];
    }
  }

  if (!teamDir || !memberName || !initialTask) {
    return null;
  }
  return { teamDir, memberName, initialTask, providerName };
}

// ShutdownPrefix marks a mailbox message as a request to terminate the teammate.
const ShutdownPrefix = "[shutdown]";

// LeadName is the conventional mailbox recipient for the coordinator.
const LeadName = "lead";

// Module-level child logger for teammate process.
const log = createChildLogger({ module: "teammate" });

function isShutdownRequest(msg: FileMailMessage): boolean {
  return msg.text.trimStart().startsWith(ShutdownPrefix);
}

function createIdleNotification(memberName: string): FileMailMessage {
  return {
    from: memberName,
    text: `[idle] ${memberName} has completed their task and is waiting for new instructions.`,
    timestamp: new Date().toISOString(),
  };
}

export async function runTeammate(args: TeammateArgs): Promise<void> {
  // Initialize logger for this teammate subprocess. Subprocess skips cleanup
  // to avoid multi-process races on unlinkSync.
  const safeMemberName = sanitizeNameSegment(args.memberName);
  initLogger({
    sessionId: `teammate-${safeMemberName}-${Date.now().toString(36)}`,
    mode: "teammate",
    workDir: args.teamDir,
    skipCleanup: true,
  });
  process.on("exit", closeLogger);
  log.info({ memberName: args.memberName, teamDir: args.teamDir }, "teammate started");

  const cfg = loadConfig();
  const provider = args.providerName
    ? (cfg.providers.find((p) => p.name === args.providerName) ?? cfg.providers[0])
    : cfg.providers[0];

  const env = detectEnvironment(process.cwd());
  env.model = provider.model;
  const systemPrompt = buildSystemPrompt(env);
  const client = await createClient(provider, systemPrompt);

  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new BashTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());

  const conversation = new ConversationManager();
  const checker = new PermissionChecker(process.cwd(), "acceptEdits");

  const agent = new Agent({
    client,
    registry,
    checker,
    conversation,
    workDir: process.cwd(),
    fileStateCache: new FileStateCache(),
  });

  // Start with initial task
  conversation.addUserMessage(args.initialTask);

  let output = "";
  for await (const event of agent.run()) {
    switch (event.type) {
      case "stream_text":
        output += event.text;
        process.stdout.write(event.text);
        break;
      case "tool_result":
        log.info(
          { toolName: event.toolName, isError: event.isError, elapsed: event.elapsed },
          "tool result",
        );
        log.debug({ output }, "tool output");
        break;
      case "loop_complete":
        log.info("task complete");
        log.debug({ output }, "final output");
        break;
      case "error":
        log.error({ err: event.error }, "agent error");
        break;
    }
  }

  // Notify the lead that this teammate finished its initial task.
  const mailbox = new FileMailbox(args.teamDir, args.memberName);
  const leadMailbox = new FileMailbox(args.teamDir, LeadName);
  await leadMailbox.send(args.memberName, createIdleNotification(args.memberName).text);

  // Poll mailbox for follow-up messages
  for await (const msg of mailbox.poll(2000)) {
    // Graceful shutdown: stop polling and exit when the lead requests it.
    if (isShutdownRequest(msg)) {
      log.info({ memberName: args.memberName }, "shutdown requested, exiting");
      break;
    }

    log.info({ from: msg.from, text: msg.text }, "message received");
    conversation.addUserMessage(msg.text);
    for await (const event of agent.run()) {
      if (event.type === "stream_text") {
        process.stdout.write(event.text);
      }
    }

    // Notify the lead after completing each follow-up task.
    await leadMailbox.send(args.memberName, createIdleNotification(args.memberName).text);
  }
}
