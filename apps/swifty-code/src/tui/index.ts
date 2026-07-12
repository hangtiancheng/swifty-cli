// TUI entry point: renders the main App component with Ink.
// AlternateScreen is NOT used here because it creates a separate buffer
// that conflicts with <Static> (committed messages get overwritten on redraw).
// Flicker is eliminated via installSyncOutput() (DEC 2026) + Static/dynamic split.
import React from "react";
import { render } from "ink";

import { App } from "./app.js";
import { getConfig } from "../core/config.js";
import { SocketClient } from "../core/transport/socket-client.js";

export async function launchTUI(): Promise<void> {
  const config = getConfig();
  const client = new SocketClient(config.host, config.port);

  try {
    const instance = render(React.createElement(App, { _config: config, client }), {
      exitOnCtrlC: false,
    });

    await instance.waitUntilExit();
  } catch (error) {
    console.error("Failed to launch TUI:", error);
    process.exit(1);
  }
}
