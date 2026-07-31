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

// Client for the Claude Code VSCode extension's embedded MCP server. After
// connecting we announce ourselves with `ide_connected` (the extension routes
// Cmd+Option+K to the CLI whose pid matches the active terminal) and listen
// for `at_mentioned` notifications carrying file path + 0-based line range.

import { createChildLogger } from "../logger/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import { detectIde } from "./lockfile.js";
import { WebSocketTransport } from "./ws-transport.js";

const log = createChildLogger({ module: "vscode" });

export interface IdeAtMention {
  filePath: string;
  /** 1-based */
  lineStart?: number;
  /** 1-based */
  lineEnd?: number;
}

export interface IdeConnection {
  ideName: string;
  close: () => Promise<void>;
}

const AtMentionedSchema = z.object({
  method: z.literal("at_mentioned"),
  params: z.object({
    filePath: z.string(),
    lineStart: z.number().optional(),
    lineEnd: z.number().optional(),
  }),
});

function inIdeTerminal(): boolean {
  return process.env.CLAUDE_CODE_SSE_PORT !== undefined || process.env.TERM_PROGRAM === "vscode";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function connectToIde(opts: {
  cwd: string;
  onAtMentioned: (mention: IdeAtMention) => void;
  onDisconnect?: () => void;
}): Promise<IdeConnection | null> {
  // Only poll when we're plausibly inside an IDE terminal — the extension
  // may still be activating right after the window opens.
  const deadline = Date.now() + (inIdeTerminal() ? 30_000 : 0);

  let ide = await detectIde(opts.cwd);
  while (!ide && Date.now() < deadline) {
    await sleep(1000);
    ide = await detectIde(opts.cwd);
  }
  if (!ide) {
    return null;
  }

  const transport = new WebSocketTransport(ide.url, {
    ...(ide.authToken && { "X-Claude-Code-Ide-Authorization": ide.authToken }),
  });
  const client = new Client({ name: "larky", version: "0.1.0" }, {});

  try {
    await client.connect(transport);
  } catch (err) {
    log.error({ err, url: ide.url }, "failed to connect to IDE extension");
    return null;
  }

  transport.onclose = () => {
    opts.onDisconnect?.();
  };

  client.setNotificationHandler(AtMentionedSchema, (notification: unknown) => {
    const parsed = AtMentionedSchema.safeParse(notification);
    if (!parsed.success) {
      return;
    }
    const { filePath, lineStart, lineEnd } = parsed.data.params;
    opts.onAtMentioned({
      filePath,
      // Extension sends 0-based lines; expose 1-based like editors display.
      lineStart: lineStart !== undefined ? lineStart + 1 : undefined,
      lineEnd: lineEnd !== undefined ? lineEnd + 1 : undefined,
    });
  });

  try {
    await client.notification({ method: "ide_connected", params: { pid: process.pid } });
  } catch (err) {
    log.error({ err }, "failed to send ide_connected notification");
  }

  log.info({ ideName: ide.ideName, port: ide.port }, "connected to IDE extension");
  return {
    ideName: ide.ideName,
    close: async () => {
      transport.onclose = undefined;
      try {
        await client.close();
      } catch (err) {
        log.error({ err }, "failed to close IDE client");
      }
    },
  };
}
