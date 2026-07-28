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

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileStateCache } from "@/tools/file-state-cache.js";
import { ReadFileTool } from "@/tools/read-file.js";
import type { ToolContext } from "@/tools/types.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

let workDir: string;
const tool = new ReadFileTool();

function ctx(): ToolContext {
  return { workDir, fileStateCache: new FileStateCache() };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "larky-read-image-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("ReadFileTool image branch", () => {
  it("returns an image attachment and placeholder output for a png", async () => {
    const p = join(workDir, "shot.png");
    const buf = Buffer.concat([PNG_MAGIC, Buffer.from("fakepayload")]);
    writeFileSync(p, buf);

    const result = await tool.execute(ctx(), { file_path: p });
    expect(result.isError).toBe(false);
    expect(result.images).toHaveLength(1);
    expect(result.images?.[0]?.mediaType).toBe("image/png");
    expect(result.images?.[0]?.data).toBe(buf.toString("base64"));
    expect(result.images?.[0]?.sourcePath).toBe(p);
    expect(result.output).toContain("[image: shot.png");
  });

  it("detects media type from magic bytes, not the extension", async () => {
    // JPEG bytes in a .png file → media type must be image/jpeg
    const p = join(workDir, "mislabeled.png");
    writeFileSync(p, Buffer.concat([JPEG_MAGIC, Buffer.from("fake")]));

    const result = await tool.execute(ctx(), { file_path: p });
    expect(result.isError).toBe(false);
    expect(result.images?.[0]?.mediaType).toBe("image/jpeg");
  });

  it("records the file in fileStateCache", async () => {
    const p = join(workDir, "shot.png");
    writeFileSync(p, Buffer.concat([PNG_MAGIC, Buffer.from("x")]));
    const cache = new FileStateCache();
    const spy = vi.spyOn(cache, "record");

    await tool.execute({ workDir, fileStateCache: cache }, { file_path: p });
    expect(spy).toHaveBeenCalledWith(p, expect.any(Number));
  });

  it("ignores offset/limit for images", async () => {
    const p = join(workDir, "shot.png");
    const buf = Buffer.concat([PNG_MAGIC, Buffer.from("fakepayload")]);
    writeFileSync(p, buf);

    const result = await tool.execute(ctx(), { file_path: p, offset: 5, limit: 1 });
    expect(result.isError).toBe(false);
    expect(result.images?.[0]?.data).toBe(buf.toString("base64"));
  });

  it("errors on an image-extension file with non-image contents", async () => {
    const p = join(workDir, "fake.png");
    writeFileSync(p, "just text pretending to be a png");

    const result = await tool.execute(ctx(), { file_path: p });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Error reading image");
    expect(result.images).toBeUndefined();
  });

  it("still reads text files with line numbers (regression)", async () => {
    const p = join(workDir, "code.ts");
    writeFileSync(p, "line one\nline two");

    const result = await tool.execute(ctx(), { file_path: p });
    expect(result.isError).toBe(false);
    expect(result.images).toBeUndefined();
    expect(result.output).toBe("1\tline one\n2\tline two");
  });
});
