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

// TUI launcher used by the client process (cli/main.ts and dev.ts).
// Connects a SocketClient to the daemon, enters the alt screen, installs the
// BSU/ESU sync-output patch, renders the Ink App, and restores the primary
// screen on exit.
import { render } from "ink";
import { useState } from "react";

import { loadConfig, type ProviderConfig } from "../config/config.js";
import { getConfig } from "../core/config.js";
import { SocketClient } from "../core/transport/socket-client.js";
import { initLogger } from "../logger/index.js";
import { newSessionId } from "../session/session.js";

import { App } from "./app.js";
import { ProviderSelect } from "./provider-select.js";
import { installSyncOutput } from "./sync-output.js";

interface AppShellProps {
  client: SocketClient;
  providers: ProviderConfig[];
  permissionMode?: string;
  onSessionChange: (id: string) => void;
}

// With multiple configured providers, show
// the picker before mounting App so session.create carries the chosen one.
// eslint-disable-next-line react-refresh/only-export-components
function AppShell({ client, providers, permissionMode, onSessionChange }: AppShellProps) {
  const [provider, setProvider] = useState<ProviderConfig | null>(
    providers.length === 1 ? providers[0] : null,
  );
  if (!provider) {
    return <ProviderSelect providers={providers} onSelect={setProvider} />;
  }
  return (
    <App
      client={client}
      provider={provider}
      permissionMode={permissionMode}
      onSessionChange={onSessionChange}
    />
  );
}

export async function launchTUI(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.providers.length === 0) {
    throw new Error("no LLM providers configured (.larky/config.yaml)");
  }
  const larkyCfg = getConfig();
  const client = new SocketClient(larkyCfg.host, larkyCfg.port);

  initLogger({ sessionId: newSessionId(), mode: "tui" });

  installSyncOutput();
  let sessionId = "";
  const instance = render(
    <AppShell
      client={client}
      providers={cfg.providers}
      permissionMode={cfg.permission_mode}
      onSessionChange={(id) => {
        sessionId = id;
      }}
    />,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  // Best-effort: release the daemon-side session (a standing daemon would
  // otherwise leak one AgentSession per TUI launch). Bounded so a wedged
  // daemon cannot block exit.
  if (sessionId) {
    await Promise.race([
      client.sendCommand("session.close", { session_id: sessionId }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
  client.close();
}
