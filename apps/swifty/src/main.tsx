import { render } from "ink";
import { loadConfig } from "./config/config.js";
import { App } from "./tui/app.js";
import { parseTeammateFlags, runTeammate } from "./teammate.js";
import { asErrorString } from "./utils/index.js";
import { initLogger, closeLogger, logger } from "./logger/index.js";
import { newSessionId } from "./session/session.js";
import cliCursor from "cli-cursor";
import { openSync, writeSync, closeSync } from "node:fs";
import { parsePrintFlags, runPrintMode } from "./print-mode.js";
import { installSyncOutput } from "./tui/sync-output.js";
async function main() {
  const args = process.argv.slice(2);

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

  // Parse --remote mode flags — mirrors Go's main.go --remote handling.
  let remoteAddr = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--remote") {
      remoteAddr = ":18888";
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        remoteAddr = args[i + 1];
        i++;
      }
    }
  }

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

  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    console.error(`Error: ${asErrorString(err)}`);
    process.exit(1);
  }

  if (args.includes("--remote") && remoteAddr) {
    const { RemoteServer } = await import("./remote/server.js");
    initLogger({ sessionId: newSessionId(), mode: "remote" });
    const srv = new RemoteServer({
      providers: cfg.providers,
      mcpServers: cfg.mcp_servers,
      hookConfigs: cfg.hooks,
      addr: remoteAddr,
    });
    try {
      await srv.run();
      // await new Promise(() => {
      //   /** noop */
      // });
    } catch (err) {
      console.error(`Remote server error: ${asErrorString(err)}`);
      process.exit(1);
    }
    return;
  }

  // TUI mode: initialize logger before rendering.
  initLogger({ sessionId: newSessionId(), mode: "tui" });

  // Patch cli-cursor to write hide/show to the actual TTY, not stderr
  let ttyFd: number | null = null;
  try {
    ttyFd = openSync("/dev/tty", "w");
  } catch (err) {
    console.error(err);
  }

  const writeTty = (seq: string) => {
    if (ttyFd !== null) {
      writeSync(ttyFd, seq);
    }
    process.stdout.write(seq);
    process.stderr.write(seq);
  };

  // Intercept cli-cursor to prevent Ink from re-showing cursor
  const origShow = cliCursor.show.bind(cliCursor);
  cliCursor.show = () => {
    /** noop */
  };

  writeTty("\x1b[?25l");

  const restoreCursor = () => {
    cliCursor.show = origShow;
    writeTty("\x1b[?25h");
    if (ttyFd !== null) {
      try {
        closeSync(ttyFd);
      } catch (err) {
        console.error(err);
      }
      ttyFd = null;
    }
  };
  process.on("exit", restoreCursor);

  installSyncOutput();
  const instance = render(
    <App
      providers={cfg.providers}
      mcpServers={cfg.mcp_servers}
      hooks={cfg.hooks}
      sandboxConfig={cfg.sandbox}
      enableCoordinatorMode={cfg.enable_coordinator_mode}
    />,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  // restoreCursor();
}

main().catch((err: unknown) => {
  console.error(err);
  logger.fatal({ err }, "main() unhandled error");
  process.exit(-1);
});

// Flush logs on exit.
process.on("exit", closeLogger);

// Catch async errors that escape the main loop.
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
