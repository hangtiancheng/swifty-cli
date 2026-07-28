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

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadImageRef, saveSessionImages } from "@/images/store.js";
import type { ImageAttachment } from "@/images/types.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function attachment(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  const buf = Buffer.concat([PNG_MAGIC, Buffer.from("payload")]);
  return {
    mediaType: "image/png",
    data: buf.toString("base64"),
    sourcePath: "/tmp/original.png",
    byteLength: buf.length,
    ...overrides,
  };
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "larky-image-store-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("saveSessionImages", () => {
  it("writes binaries and returns refs", () => {
    const refs = saveSessionImages(workDir, "sess1", [attachment()]);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.path).toContain(join(".larky", "sessions", "sess1", "images"));
    expect(refs[0]?.media_type).toBe("image/png");
    expect(refs[0]?.source_path).toBe("/tmp/original.png");
  });

  it("deduplicates identical content (content-addressed)", () => {
    const refs = saveSessionImages(workDir, "sess1", [attachment(), attachment()]);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.path).toBe(refs[1]?.path);
    const files = readdirSync(join(workDir, ".larky", "sessions", "sess1", "images"));
    expect(files).toHaveLength(1);
  });
});

describe("loadImageRef", () => {
  it("round-trips base64 exactly", () => {
    const original = attachment();
    const [ref] = saveSessionImages(workDir, "sess1", [original]);
    const restored = loadImageRef(ref);
    expect(restored).not.toBeNull();
    expect(restored?.data).toBe(original.data);
    expect(restored?.mediaType).toBe("image/png");
    expect(restored?.sourcePath).toBe("/tmp/original.png");
    expect(restored?.byteLength).toBe(original.byteLength);
  });

  it("returns null for a missing file", () => {
    const restored = loadImageRef({
      path: join(workDir, "nope.png"),
      media_type: "image/png",
    });
    expect(restored).toBeNull();
  });
});
