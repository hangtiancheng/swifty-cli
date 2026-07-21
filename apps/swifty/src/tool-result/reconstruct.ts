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

import type { Message } from "../conversation/conversation.js";
import { ConversationManager } from "../conversation/conversation.js";

export function buildManager(messages: Message[]): ConversationManager {
  const mgr = new ConversationManager();
  for (const msg of messages) {
    if (msg.toolUses && msg.toolUses.length > 0) {
      mgr.addAssistantFull(msg.content, msg.thinkingBlocks ?? [], msg.toolUses);
    } else if (msg.toolResults && msg.toolResults.length > 0) {
      mgr.addToolResultsMessage(msg.toolResults);
    } else if (msg.role === "user") {
      mgr.addUserMessage(msg.content);
    } else if (msg.role === "assistant") {
      mgr.addAssistantMessage(msg.content);
    }
  }
  return mgr;
}
