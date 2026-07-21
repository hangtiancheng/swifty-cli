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

// CLI chat command: multi-turn interactive chat session with permission prompts
import process from "node:process";
import readline from "node:readline";

import type { SwiftyConfig } from "../../core/config.js";
import { SocketClient } from "../../core/transport/socket-client.js";

const DECISION_MAP: Record<string, string> = {
  y: "allow_once",
  a: "always_allow",
  n: "deny_once",
  d: "always_deny",
};

class ChatPrinter {
  private _inline = false;
  pendingPermissionId: string | null = null;

  handle(event: Record<string, unknown>): void {
    const eventType = event["type"];
    switch (eventType) {
      case "llm.token":
        process.stdout.write(String(event["token"]));
        this._inline = true;
        break;
      case "tool.call_started":
        this._ensureNewline();
        console.log(`[tool] ${String(event["tool_name"])}`);
        break;
      case "permission.requested": {
        this._ensureNewline();
        console.log(`[permission] ${String(event["tool_name"])} ${String(event["param_preview"])}`);
        console.log("  [y] allow once  [a] always allow  [n] deny once  [d] always deny");
        const toolUseId = event["tool_use_id"];
        this.pendingPermissionId = typeof toolUseId === "string" ? toolUseId : null;
        break;
      }
      case "session.waiting_for_input":
        this._ensureNewline();
        this.pendingPermissionId = null;
        console.log("[waiting for input]");
        break;
      case "session.closed":
        this._ensureNewline();
        console.log("session closed.");
        break;
    }
  }

  private _ensureNewline(): void {
    if (this._inline) {
      process.stdout.write("\n");
      this._inline = false;
    }
  }
}

// Prompt for one line of input.
// Resolves to the entered line, or null when the user requests exit:
// - Ctrl+D / EOF closes the readline interface ("close" event)
// - Ctrl+C is delivered as the readline "SIGINT" event
function readlinePrompt(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(value);
    };

    rl.on("SIGINT", () => {
      process.stdout.write("\n");
      finish(null);
    });
    rl.on("close", () => {
      // Ctrl+D / EOF (also fires after finish(); the settled guard makes it a no-op)
      finish(null);
    });
    rl.question(prompt, (answer) => {
      finish(answer);
    });
  });
}

export async function cmdChat(config: SwiftyConfig): Promise<void> {
  const client = new SocketClient(config.host, config.port);
  await client.connect();

  const printer = new ChatPrinter();
  client.onEvent((event) => {
    printer.handle(event);
    return Promise.resolve();
  });

  // Start event loop
  void client.runEventLoop();

  // Subscribe to relevant events
  await client.sendCommand("event.subscribe", {
    topics: ["session.*", "run.*", "tool.*", "llm.token", "permission.*"],
    scope: "global",
  });

  // Create chat session
  const createResult = await client.sendCommand("session.create", {
    mode: "chat",
  });
  const sessionId = String(createResult["session_id"]);
  console.log(`[session: ${sessionId}]`);

  try {
    for (;;) {
      const line = await readlinePrompt("> ");
      // Sentinel: Ctrl+C / Ctrl+D — break to normal cleanup, exit code 0.
      // Breaking (not looping) also avoids a busy loop after EOF, where
      // readline would resolve immediately forever.
      if (line === null) break;
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Handle permission response
      if (printer.pendingPermissionId) {
        const decision = DECISION_MAP[trimmed];
        if (!decision) {
          console.log("Invalid decision. Use: y, a, n, d");
          continue;
        }
        // Clear the pending id before sending so a failed send does not leave
        // a stale id that would swallow the next chat message.
        const toolUseId = printer.pendingPermissionId;
        printer.pendingPermissionId = null;
        await client.sendCommand("permission.respond", {
          tool_use_id: toolUseId,
          decision,
        });
        continue;
      }

      // Normal chat message
      await client.sendCommand("session.send_message", {
        session_id: sessionId,
        content: trimmed,
      });
    }
  } finally {
    // Close session (best effort — the daemon may already be gone)
    try {
      await client.sendCommand("session.close", { session_id: sessionId });
    } catch {
      // Ignore failures during cleanup
    }
    client.close();
  }

  process.exit(0);
}
