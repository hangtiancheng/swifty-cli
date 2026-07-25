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
// The whole TUI runs inside the terminal's alternate screen buffer; the message
// history is scrolled by the app's own viewport (see app.tsx), not by the
// terminal scrollback. Flicker is eliminated via installSyncOutput() (DEC 2026).
import React from "react";
import { render } from "ink";

import { App } from "./app.js";
import { rawStdoutWrite } from "./sync-output.js";
import { getConfig } from "../core/config.js";
import { SocketClient } from "../core/transport/socket-client.js";

export async function launchTUI(): Promise<void> {
  const config = getConfig();
  const client = new SocketClient(config.host, config.port);

  // Enter the alt-screen, then clear and home the cursor: emitting only ?1049h
  // leaves the cursor at its pre-switch position (typically the terminal
  // bottom), causing the TUI to render downward from there, pinned to the
  // bottom of the screen. rawStdoutWrite bypasses the sync-output patch so the
  // escape sequence is not wrapped in BSU/ESU markers (which would render it
  // ineffective on some terminals).
  rawStdoutWrite("\x1b[?1049h\x1b[2J\x1b[H");
  try {
    const instance = render(React.createElement(App, { _config: config, client }), {
      exitOnCtrlC: false,
    });

    await instance.waitUntilExit();
  } catch (error) {
    rawStdoutWrite("\x1b[?1049l");
    console.error("Failed to launch TUI:", error);
    process.exit(1);
  }
  // Restore the user's primary terminal screen after Ink exits.
  rawStdoutWrite("\x1b[?1049l");
}
