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

import { mcpContentToToolOutput } from "../src/mcp/client.js";
import { isRecord } from "../src/utils/index.js";

// Small buffers pass through maybeResizeAndDownsampleImage untouched (sharp is
// only consulted above the passthrough limit), so fake bytes are fine here.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA = Buffer.concat([PNG_MAGIC, Buffer.from("mcp-image")]).toString("base64");

describe("mcpContentToToolOutput", () => {
  it("keeps text-only content as a plain string", async () => {
    const out = await mcpContentToToolOutput([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ]);
    expect(out).toBe("hello\nworld");
  });

  it("passes image content through as provider-style blocks", async () => {
    const out = await mcpContentToToolOutput([
      { type: "text", text: "screenshot below" },
      { type: "image", data: DATA, mimeType: "image/png" },
    ]);
    if (typeof out === "string") {
      throw new Error("expected content blocks");
    }
    expect(out[0]).toEqual({ type: "text", text: "screenshot below" });
    expect(out[1].type).toBe("image");
    const source = out[1].source;
    expect(isRecord(source) ? source.media_type : null).toBe("image/png");
    expect(isRecord(source) ? source.data : null).toBe(DATA);
  });

  it("omits the text block when the content is image-only", async () => {
    const out = await mcpContentToToolOutput([{ type: "image", data: DATA, mimeType: "image/png" }]);
    if (typeof out === "string") {
      throw new Error("expected content blocks");
    }
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("image");
  });

  it("keeps unsupported mime types in the JSON text form", async () => {
    const out = await mcpContentToToolOutput([
      { type: "image", data: DATA, mimeType: "image/tiff" },
    ]);
    expect(typeof out).toBe("string");
    expect(out).toContain("image/tiff");
  });
});
