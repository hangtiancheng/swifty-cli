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

// ReadFileTool image behavior, mirroring the pre-refactor read-file-image
// suite on the content-block pipeline: images come back as [label text block,
// image block], magic bytes beat the extension, reads are recorded in the
// fileStateCache, and non-image bytes behind an image extension error out.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { FileStateCache } from "../src/tools/file-state-cache.js";
import { ReadFileTool } from "../src/tools/read-file.js";
import type { ToolContext } from "../src/tools/types.js";
import { isRecord, strArg } from "../src/utils/index.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function ctx(): ToolContext {
  return {
    workDir: mkdtempSync(join(tmpdir(), "swifty-rf-img-")),
    fileStateCache: new FileStateCache(),
  };
}

function blocksOf(output: string | Record<string, unknown>[]) {
  if (typeof output === "string") {
    throw new Error("expected content blocks, got string: " + output);
  }
  return output;
}

describe("ReadFileTool images", () => {
  it("returns a label text block plus an inline image block for a png", async () => {
    const c = ctx();
    const buf = Buffer.concat([PNG_MAGIC, Buffer.from("tiny-png")]);
    const p = join(c.workDir, "shot.png");
    writeFileSync(p, buf);

    const result = await new ReadFileTool().execute(c, { file_path: p });
    expect(result.isError).toBe(false);
    const blocks = blocksOf(result.output);
    expect(strArg(blocks[0], "text")).toContain("[image: shot.png");
    const source = blocks[1].source;
    expect(blocks[1].type).toBe("image");
    expect(isRecord(source) ? source.media_type : null).toBe("image/png");
    expect(isRecord(source) ? source.data : null).toBe(buf.toString("base64"));
  });

  it("detects the media type from magic bytes, not the extension", async () => {
    const c = ctx();
    const buf = Buffer.concat([JPEG_MAGIC, Buffer.from("jpeg-bytes")]);
    const p = join(c.workDir, "actually-jpeg.png");
    writeFileSync(p, buf);

    const result = await new ReadFileTool().execute(c, { file_path: p });
    expect(result.isError).toBe(false);
    const source = blocksOf(result.output)[1].source;
    expect(isRecord(source) ? source.media_type : null).toBe("image/jpeg");
  });

  it("records the image read in fileStateCache", async () => {
    const c = ctx();
    const p = join(c.workDir, "shot.png");
    writeFileSync(p, Buffer.concat([PNG_MAGIC, Buffer.from("x")]));

    await new ReadFileTool().execute(c, { file_path: p });
    // A recorded, unmodified file passes the edit gate.
    expect(c.fileStateCache?.check(p)).toEqual({ ok: true });
  });

  it("errors on an image-extension file with non-image contents", async () => {
    const c = ctx();
    const p = join(c.workDir, "fake.png");
    writeFileSync(p, "just text pretending to be a png");

    const result = await new ReadFileTool().execute(c, { file_path: p });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Error reading image");
  });

  it("still reads text files with line numbers (regression)", async () => {
    const c = ctx();
    const p = join(c.workDir, "a.txt");
    writeFileSync(p, "line one\nline two");

    const result = await new ReadFileTool().execute(c, { file_path: p });
    expect(result.isError).toBe(false);
    expect(result.output).toBe("1\tline one\n2\tline two");
  });
});
