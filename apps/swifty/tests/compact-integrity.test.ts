import { describe, expect, it, vi } from "vitest";

import { forceCompact } from "@/compact/compact.js";
import { ConversationManager } from "@/conversation/conversation.js";
import type { LLMClient } from "@/llm/client.js";
import { ContextTooLongError } from "@/llm/errors.js";

function history() {
  const conv = new ConversationManager();
  for (let index = 0; index < 20; index++) {
    conv.addUserMessage(`task ${String(index)} ` + "context ".repeat(200));
    conv.addAssistantMessage("answer");
  }
  conv.addAssistantMessageWithTools("read image", [
    { toolUseId: "read", toolName: "ReadFile", arguments: { file_path: "a.png" } },
  ]);
  conv.addToolResultMessage("read", "image read", false, [
    { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
  ]);
  conv.addSystemReminder("Keep the latest user constraints");
  return conv;
}

describe("compaction integrity", () => {
  it("propagates cancellation and retains the original history", async () => {
    const conv = history();
    const before = structuredClone(conv.getMessages());
    const controller = new AbortController();
    const client: LLMClient = {
      setSystemPrompt: vi.fn(),
      async *stream(_request, _tools, signal) {
        expect(signal).toBe(controller.signal);
        yield { type: "text_delta", text: "<summary>partial" };
        await Promise.resolve();
        controller.abort();
      },
    };
    await expect(forceCompact(conv, client, null, [], [], "", controller.signal)).rejects.toThrow();
    expect(conv.getMessages()).toEqual(before);
  });

  it("does not replace new messages appended while a summary is being generated", async () => {
    const conv = history();
    const client: LLMClient = {
      setSystemPrompt: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *stream() {
        conv.addUserMessage("A newer task");
        yield { type: "text_delta", text: "<summary>older task</summary>" };
      },
    };
    await expect(forceCompact(conv, client, null, [], [])).rejects.toThrow("changed");
    expect(conv.getMessages().at(-1)?.content).toBe("A newer task");
  });
  it("reuses the entire immutable request prefix, including final rich tool results and reminders", async () => {
    const conv = history();
    const before = structuredClone(conv.getMessages());
    const client: LLMClient = {
      setSystemPrompt: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *stream(request) {
        expect(request.getMessages().slice(0, -1)).toEqual(before);
        yield { type: "text_delta", text: "<summary>Retained context</summary>" };
      },
    };
    const setSystemPrompt = vi.spyOn(client, "setSystemPrompt");
    const result = await forceCompact(conv, client, null, [], []);
    expect(result.compacted).toBe(true);
    expect(conv.getMessages().flatMap((m) => m.toolResults ?? [])[0].contentBlocks).toEqual(
      before.at(-2)?.toolResults?.[0].contentBlocks,
    );
    expect(setSystemPrompt).not.toHaveBeenCalled();
  });

  it.each(["", "<analysis>unfinished reasoning</analysis>", "<summary>   </summary>"])(
    "preserves history when the summary is unusable: %j",
    async (text) => {
      const conv = history();
      const before = structuredClone(conv.getMessages());
      const client: LLMClient = {
        setSystemPrompt: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/require-await
        async *stream() {
          yield { type: "text_delta", text };
        },
      };
      await expect(forceCompact(conv, client, null, [], [])).rejects.toThrow();
      expect(conv.getMessages()).toEqual(before);
    },
  );

  it("retries typed context errors during the text fallback", async () => {
    const conv = history();
    let attempts = 0;
    const client: LLMClient = {
      setSystemPrompt: vi.fn(),
      async *stream() {
        await Promise.resolve();
        if (attempts++ < 2) {
          throw new ContextTooLongError("context too long");
        }
        yield { type: "text_delta", text: "<summary>Retained context</summary>" };
      },
    };
    expect((await forceCompact(conv, client, null, [], [])).compacted).toBe(true);
    expect(attempts).toBe(3);
  });
});
