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

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { Message } from "@/conversation/conversation.js";
import type { ImageAttachment } from "@/images/types.js";
import { buildAnthropicMessages, markLastUserTailForCache } from "@/llm/anthropic.js";
import { asRecord } from "@/utils/index.js";

function img(data = "aW1hZ2U="): ImageAttachment {
  return {
    mediaType: "image/png",
    data,
    sourcePath: "/tmp/shot.png",
    byteLength: 5,
  };
}

// Runtime-narrow a message's content to a block array, so tests fail loudly
// instead of silently passing a blind type assertion.
function contentBlocks(msg: Anthropic.MessageParam | undefined): Anthropic.ContentBlockParam[] {
  const content = msg?.content;
  if (typeof content === "string" || !Array.isArray(content)) {
    throw new Error(`expected content to be a block array, got: ${typeof content}`);
  }
  return content;
}

describe("buildAnthropicMessages with images", () => {
  it("puts user images after the text block", () => {
    const messages: Message[] = [{ role: "user", content: "what is this?", images: [img()] }];
    const out = buildAnthropicMessages(messages);
    expect(out).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "aW1hZ2U=",
            },
          },
        ],
      },
    ]);
  });

  it("embeds tool_result images as a content block array", () => {
    const messages: Message[] = [
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: "",
        toolUses: [{ toolUseId: "t1", toolName: "ReadFile", arguments: {} }],
      },
      {
        role: "user",
        content: "",
        toolResults: [
          {
            toolUseId: "t1",
            content: "[image: shot.png]",
            isError: false,
            images: [img()],
          },
        ],
      },
    ];
    const out = buildAnthropicMessages(messages);
    const toolResultMsg = out[2];
    expect(toolResultMsg?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "t1",
        is_error: false,
        content: [
          { type: "text", text: "[image: shot.png]" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "aW1hZ2U=",
            },
          },
        ],
      },
    ]);
  });

  it("keeps tool_result content as a plain string when there are no images", () => {
    const messages: Message[] = [
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: "",
        toolUses: [{ toolUseId: "t1", toolName: "ReadFile", arguments: {} }],
      },
      {
        role: "user",
        content: "",
        toolResults: [{ toolUseId: "t1", content: "text result", isError: false }],
      },
    ];
    const out = buildAnthropicMessages(messages);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const blocks = out[2]?.content as Anthropic.ToolResultBlockParam[];
    expect(blocks[0]?.content).toBe("text result");
  });

  it("merges consecutive user messages when one carries images (post-compaction)", () => {
    // summary(user) + kept user with image must merge into ONE user entry
    // to preserve strict alternation.
    const messages: Message[] = [
      { role: "user", content: "summary of earlier conversation" },
      { role: "user", content: "kept message with image", images: [img()] },
    ];
    const out = buildAnthropicMessages(messages);
    expect(out).toHaveLength(1);
    const content = contentBlocks(out[0]);
    expect(content.map((b) => b.type)).toEqual(["text", "text", "image"]);
  });

  it("still merges a following text-only user after an image-carrying user", () => {
    const messages: Message[] = [
      { role: "user", content: "with image", images: [img()] },
      { role: "user", content: "follow-up text" },
    ];
    const out = buildAnthropicMessages(messages);
    expect(out).toHaveLength(1);
    const content = contentBlocks(out[0]);
    expect(content.map((b) => b.type)).toEqual(["text", "image", "text"]);
  });

  it("produces identical output to before for image-free conversations", () => {
    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "bye" },
    ];
    expect(buildAnthropicMessages(messages)).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
      { role: "user", content: [{ type: "text", text: "bye" }] },
    ]);
  });
});

describe("markLastUserTailForCache with images", () => {
  it("marks the last non-image block, not the trailing image", () => {
    const messages = buildAnthropicMessages([
      { role: "user", content: "look at this", images: [img()] },
    ]);
    markLastUserTailForCache(messages);
    const content = contentBlocks(messages[0]);
    const textBlock = content[0];
    const imageBlock = content[1];
    expect(asRecord(textBlock).cache_control).toEqual({
      type: "ephemeral",
    });
    expect(asRecord(imageBlock).cache_control).toBeUndefined();
  });

  it("falls back to the tail when every block is an image", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "aW1hZ2U=",
            },
          },
        ],
      },
    ];
    markLastUserTailForCache(messages);
    const content = contentBlocks(messages[0]);
    const imageBlock = content[0];
    expect(asRecord(imageBlock).cache_control).toEqual({ type: "ephemeral" });
  });

  it("keeps marking plain text messages unchanged", () => {
    const messages = buildAnthropicMessages([{ role: "user", content: "hello" }]);
    markLastUserTailForCache(messages);
    const content = contentBlocks(messages[0]);
    const textBlock = content[0];
    expect(asRecord(textBlock).cache_control).toEqual({ type: "ephemeral" });
  });
});
