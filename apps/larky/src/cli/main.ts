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

// CLI entry point (client process). Mode dispatch mirrors larky main.tsx:
//   larky                 → TUI (starts daemon if needed, connects over TCP)
//   larky -p "<prompt>"   → print mode (in-process agent, no daemon)
//   larky --teammate ...  → teammate subprocess entry (tmux/iterm team backends)
//   larky --remote [addr] → Koa+WS remote server (in-process agent)
//   larky ping|version|core start|stop|status|trace ...
import process from "node:process";

import { getConfig } from "../core/config.js";
import { setupLogging } from "../core/logging.js";
import { cmdPing } from "../core/commands/ping.js";
import { cmdVersion } from "./commands/version.js";
import {
  cmdCoreStart,
  cmdCoreStop,
  cmdCoreStatus,
  ensureDaemonRunning,
  stopDaemonOnExit,
} from "./commands/core.js";
import { cmdTrace } from "./commands/trace.js";

import { forkEnabled, loadConfig } from "../config/config.js";
import { parseTeammateFlags, runTeammate } from "../teammate.js";
import { parsePrintFlags, runPrintMode } from "../print-mode.js";
import { initLogger, closeLogger, logger } from "../logger/index.js";
import { newSessionId } from "../session/session.js";
import { asErrorString } from "../utils/index.js";

const VALID_TRACE_LAYERS = ["ipc", "event", "llm"];

function printHelp(): void {
  console.log(`larky — dual-process CLI coding agent

Usage:
  larky                       Launch the TUI (starts the daemon if needed)
  larky -p "<prompt>"         Print mode: run one prompt non-interactively
  larky --remote [addr]       Serve the browser UI (default :18888)
  larky ping                  Ping the daemon
  larky version               Print version
  larky core start|stop|status  Manage the daemon
  larky trace [run_id] [--layer ipc|event|llm] [--raw] [--follow]`);
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Teammate subprocess entry (spawned by tmux/iterm team backends).
  const teammateArgs = parseTeammateFlags(args);
  if (teammateArgs) {
    try {
      await runTeammate(teammateArgs);
    } catch (err) {
      console.error(`teammate: ${asErrorString(err)}`);
      process.exit(1);
    }
    return;
  }

  // Print mode: in-process one-shot agent run (no daemon round-trip).
  const printArgs = parsePrintFlags(args);
  if (printArgs) {
    try {
      await runPrintMode(printArgs);
    } catch (err) {
      console.error(`Error: ${asErrorString(err)}`);
      process.exit(1);
    }
    return;
  }

  // Remote mode: Koa HTTP + WebSocket server hosting the browser frontend.
  if (args.includes("--remote")) {
    let remoteAddr = ":18888";
    const idx = args.indexOf("--remote");
    if (idx + 1 < args.length && !args[idx + 1].startsWith("-")) {
      remoteAddr = args[idx + 1];
    }
    let cfg;
    try {
      cfg = loadConfig();
    } catch (err) {
      console.error(`Error: ${asErrorString(err)}`);
      process.exit(1);
    }
    const { RemoteServer } = await import("../remote/server.js");
    initLogger({ sessionId: newSessionId(), mode: "remote" });
    const srv = new RemoteServer({
      providers: cfg.providers,
      mcpServers: cfg.mcp_servers,
      hookConfigs: cfg.hooks,
      addr: remoteAddr,
      enableCoordinatorMode: cfg.enable_coordinator_mode ?? false,
      forkDisabled: !forkEnabled(cfg),
    });
    try {
      await srv.run();
    } catch (err) {
      console.error(`Remote server error: ${asErrorString(err)}`);
      process.exit(1);
    }
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--version") || args.includes("-V")) {
    cmdVersion();
    return;
  }

  const config = getConfig();
  setupLogging(config);

  // No command: launch the terminal UI, starting the daemon if needed.
  // If this process spawned the daemon, shut it down when the TUI exits.
  if (args.length === 0) {
    const startedDaemon = await ensureDaemonRunning(config);
    if (startedDaemon) stopDaemonOnExit(config);
    const { launchTUI } = await import("../tui/index.js");
    await launchTUI();
    process.exit(0);
  }

  const subcommand = args[0];

  switch (subcommand) {
    case "ping":
      await cmdPing(config);
      break;

    case "version":
      cmdVersion();
      break;

    case "core": {
      const coreSubcommand = args[1];
      switch (coreSubcommand) {
        case "start":
          cmdCoreStart(config);
          break;
        case "stop":
          cmdCoreStop(config);
          break;
        case "status":
          await cmdCoreStatus(config);
          break;
        default:
          console.error(`Unknown core subcommand: ${coreSubcommand}`);
          printHelp();
          process.exit(1);
      }
      break;
    }

    case "trace": {
      // First positional (non-flag) argument after "trace" is the run_id
      const runIdArg = args[1];
      const runId = runIdArg !== undefined && !runIdArg.startsWith("-") ? runIdArg : null;
      const raw = args.includes("--raw");
      const follow = args.includes("--follow") || args.includes("-f");
      const layer = readFlagValue(args, "--layer");
      const direction = readFlagValue(args, "--direction");
      if (layer !== undefined && !VALID_TRACE_LAYERS.includes(layer)) {
        console.error(
          `Error: invalid --layer "${layer}" (must be one of: ${VALID_TRACE_LAYERS.join(", ")})`,
        );
        printHelp();
        process.exit(1);
      }
      const options: {
        layer?: string;
        direction?: string;
        raw?: boolean;
        follow?: boolean;
      } = {};
      if (layer) options.layer = layer;
      if (direction) options.direction = direction;
      if (raw) options.raw = true;
      if (follow) options.follow = true;
      cmdTrace(runId, config, options);
      break;
    }

    default:
      console.error(`Unknown command: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

// Flush larky logs on exit.
process.on("exit", closeLogger);

process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason);
  logger.fatal({ err: reason }, "unhandled rejection");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err);
  logger.fatal({ err }, "uncaught exception");
  process.exit(1);
});

const isDirectRun = process.argv[1].endsWith("/main.ts") || process.argv[1].endsWith("/main.js");

if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
