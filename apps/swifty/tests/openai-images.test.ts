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

import { describe, expect, it } from "vitest";
import type { Message } from "@/conversation/conversation.js";
import type { ImageAttachment } from "@/images/types.js";
import { buildChatCompletionMessages, buildOpenAIInput } from "@/llm/openai.js";

function img(data = "aW1hZ2U="): ImageAttachment {
  return {
    mediaType: "image/png",
    data,
    sourcePath: "/tmp/shot.png",
    byteLength: 5,
  };
}

const DATA_URL = "data:image/png;base64,aW1hZ2U=";

describe("buildOpenAIInput (Responses API) with images", () => {
  it("converts user images to input_image parts after the text", () => {
    const out = buildOpenAIInput([{ role: "user", content: "what is this?", images: [img()] }]);
    expect(out).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "what is this?" },
          { type: "input_image", image_url: DATA_URL, detail: "auto" },
        ],
      },
    ]);
  });

  it("appends tool images as a synthetic user message after the whole output batch", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "",
        toolResults: [
          { toolUseId: "t1", content: "[image: a.png]", isError: false, images: [img()] },
          { toolUseId: "t2", content: "plain text", isError: false },
        ],
      },
    ];
    const out = buildOpenAIInput(messages);
    expect(out.map((item) => ("type" in item ? item.type : item.role))).toEqual([
      "function_call_output",
      "function_call_output",
      "user",
    ]);
    const synthetic = out[2];
    if (!synthetic || !("role" in synthetic)) {
      throw new Error("expected a synthetic user message at index 2");
    }
    expect(synthetic.content).toEqual([
      { type: "input_text", text: "[Image(s) returned by tool call t1]" },
      { type: "input_image", image_url: DATA_URL, detail: "auto" },
    ]);
  });

  it("keeps image-free conversations byte-identical to before", () => {
    const messages: Message[] = [
      { role: "user", content: "hello" },
      {
        role: "user",
        content: "",
        toolResults: [{ toolUseId: "t1", content: "result", isError: false }],
      },
    ];
    expect(buildOpenAIInput(messages)).toEqual([
      { role: "user", content: "hello" },
      { type: "function_call_output", call_id: "t1", output: "result" },
    ]);
  });
});

describe("buildChatCompletionMessages (Chat Completions) with images", () => {
  it("converts user images to image_url parts after the text", () => {
    const out = buildChatCompletionMessages([
      { role: "user", content: "what is this?", images: [img()] },
    ]);
    expect(out).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: DATA_URL } },
        ],
      },
    ]);
  });

  it("keeps role:tool content a plain string and appends a synthetic user message", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "",
        toolResults: [
          { toolUseId: "t1", content: "[image: a.png]", isError: false, images: [img()] },
          { toolUseId: "t2", content: "plain", isError: false },
        ],
      },
    ];
    const out = buildChatCompletionMessages(messages);
    expect(out.map((p) => p.role)).toEqual(["tool", "tool", "user"]);
    expect(out[0]?.content).toBe("[image: a.png]");
    expect(out[1]?.content).toBe("plain");
    expect(out[2]?.content).toEqual([
      { type: "text", text: "[Image(s) returned by tool call t1]" },
      { type: "image_url", image_url: { url: DATA_URL } },
    ]);
  });

  it("keeps image-free conversations byte-identical to before", () => {
    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      {
        role: "user",
        content: "",
        toolResults: [{ toolUseId: "t1", content: "result", isError: false }],
      },
    ];
    expect(buildChatCompletionMessages(messages)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "tool", tool_call_id: "t1", content: "result" },
    ]);
  });
});
