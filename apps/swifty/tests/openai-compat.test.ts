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

import { describe, it, expect } from "vitest";
import { buildChatCompletionMessages } from "../src/llm/openai.js";
import type { Message } from "../src/conversation/conversation.js";
import z, { safeParse } from "zod";

describe("openai-compat chat message building", () => {
  it("preserves assistant tool_calls and tool-result turns", () => {
    const history: Message[] = [
      { role: "user", content: "list files" },
      {
        role: "assistant",
        content: "",
        toolUses: [{ toolUseId: "c1", toolName: "Bash", arguments: { command: "ls" } }],
      },
      {
        role: "user",
        content: "",
        toolResults: [{ toolUseId: "c1", content: "a.txt", isError: false }],
      },
      { role: "assistant", content: "Found a.txt" },
    ];

    const msgs = buildChatCompletionMessages(history);

    const AssistantWithToolsSchema = z.looseObject({
      tool_calls: z.array(
        z.looseObject({
          id: z.string(),
          function: z.looseObject({
            name: z.string(),
            arguments: z.string(),
          }),
        }),
      ),
    });

    const ToolMessageSchema = z.looseObject({
      tool_call_id: z.string(),
      content: z.string(),
    });

    const assistantWithTools = msgs.find(
      (m) => m.role === "assistant" && Array.isArray(m.tool_calls),
    );
    const { success, data } = safeParse(AssistantWithToolsSchema, assistantWithTools);

    expect(assistantWithTools).toBeDefined();
    expect(success).toBe(true);
    expect(data?.tool_calls[0].id).toBe("c1");
    expect(data?.tool_calls[0].function.name).toBe("Bash");
    expect(JSON.parse(data?.tool_calls[0].function.arguments ?? "{}")).toEqual({
      command: "ls",
    });

    const toolMessage = msgs.find((m) => m.role === "tool");
    const { success: success2, data: data2 } = safeParse(ToolMessageSchema, toolMessage);

    expect(toolMessage).toBeDefined();
    expect(success2).toBe(true);
    expect(data2?.tool_call_id).toBe("c1");
    expect(data2?.content).toBe("a.txt");

    // The plain user + final assistant turns survive too.
    expect(msgs.some((m) => m.role === "user" && m.content === "list files")).toBe(true);
    expect(msgs.some((m) => m.role === "assistant" && m.content === "Found a.txt")).toBe(true);
  });
});
