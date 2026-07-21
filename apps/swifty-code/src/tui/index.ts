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
