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

// These tests run the REAL sharp pipeline (no mocks): fixtures are generated
// with sharp itself and tests/test.png is a real screenshot (JPEG bytes behind
// a .png extension, which doubles as a magic-bytes-vs-extension fixture).

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp, { type Sharp } from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { isImagePath, getMediaType, sniffMediaType } from "@/images/detect.js";
import {
  ImageTooLargeError,
  MAX_DIMENSION_PX,
  MAX_IMAGE_BYTES_PASSTHROUGH,
} from "@/images/limits.js";
import { loadImageAttachment } from "@/images/load.js";
import { maybeResizeAndDownsampleImage } from "@/images/resize.js";
import {
  saveSessionImages,
  loadImageRef,
  imageBlocksToRefBlocks,
  refBlocksToImageBlocks,
} from "@/images/store";
import type { ImageAttachment } from "@/images/types";

const TEST_PNG_PATH = join(dirname(fileURLToPath(import.meta.url)), "test.png");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_MAGIC = Buffer.from("GIF89a", "ascii");
const WEBP_MAGIC = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4),
  Buffer.from("WEBP", "ascii"),
]);

function createImageAttachment(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
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
  workDir = mkdtempSync(join(tmpdir(), "swifty-image-store-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// Gaussian noise is nearly incompressible, which is the cheapest way to make
// real oversized fixtures. Generated once and shared across tests.
function noiseImage(width: number, height: number): Sharp {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
      noise: { type: "gaussian", mean: 128, sigma: 30 },
    },
  });
}

// 1600x1600 noise PNG ≈ 6.4MB: over the 3.75MB passthrough target but under
// the 2000px dimension cap, so only re-encoding (not resizing) is required.
let oversizedPng: Buffer;
// 3000x3000 noise JPEG (q100) ≈ 10MB: over both the size and dimension caps.
let oversizedJpeg: Buffer;

beforeAll(async () => {
  [oversizedPng, oversizedJpeg] = await Promise.all([
    noiseImage(1600, 1600).png().toBuffer(),
    noiseImage(3000, 3000).jpeg({ quality: 100 }).toBuffer(),
  ]);
  expect(oversizedPng.length).toBeGreaterThan(MAX_IMAGE_BYTES_PASSTHROUGH);
  expect(oversizedJpeg.length).toBeGreaterThan(MAX_IMAGE_BYTES_PASSTHROUGH);
}, 60_000);

describe("detect", () => {
  it("maps extensions to media types", () => {
    expect(getMediaType("a/b/shot.png")).toBe("image/png");
    expect(getMediaType("shot.JPG")).toBe("image/jpeg");
    expect(getMediaType("shot.jpeg")).toBe("image/jpeg");
    expect(getMediaType("anim.gif")).toBe("image/gif");
    expect(getMediaType("pic.webp")).toBe("image/webp");
    expect(getMediaType("doc.txt")).toBeNull();
    expect(isImagePath("x.png")).toBe(true);
    expect(isImagePath("x.ts")).toBe(false);
  });

  it("sniffs magic bytes", () => {
    expect(sniffMediaType(PNG_MAGIC)).toBe("image/png");
    expect(sniffMediaType(JPEG_MAGIC)).toBe("image/jpeg");
    expect(sniffMediaType(GIF_MAGIC)).toBe("image/gif");
    expect(sniffMediaType(WEBP_MAGIC)).toBe("image/webp");
    expect(sniffMediaType(Buffer.from("not an image at all"))).toBeNull();
    expect(sniffMediaType(Buffer.alloc(0))).toBeNull();
  });

  it("sniffs the real test image as JPEG despite its .png extension", () => {
    const buf = readFileSync(TEST_PNG_PATH);
    expect(getMediaType(TEST_PNG_PATH)).toBe("image/png");
    expect(sniffMediaType(buf)).toBe("image/jpeg");
  });
});

describe("loadImageAttachment (real file)", () => {
  it("loads tests/test.png with magic bytes winning over the extension", async () => {
    const buf = readFileSync(TEST_PNG_PATH);
    const attachment = await loadImageAttachment(TEST_PNG_PATH);
    // ~123KB is under the passthrough target: the payload must be untouched.
    expect(attachment.mediaType).toBe("image/jpeg");
    expect(attachment.data).toBe(buf.toString("base64"));
    expect(attachment.byteLength).toBe(buf.length);
    expect(attachment.sourcePath).toBe(TEST_PNG_PATH);
  });
});

describe("maybeResizeAndDownsampleImage (real sharp)", () => {
  it("passes small images through byte-identical without re-encoding", async () => {
    const buf = readFileSync(TEST_PNG_PATH);
    const result = await maybeResizeAndDownsampleImage(buf, "image/jpeg");
    expect(result.data).toBe(buf.toString("base64"));
    expect(result.mediaType).toBe("image/jpeg");
    expect(result.byteLength).toBe(buf.length);
  });

  it("rejects empty buffers", async () => {
    await expect(maybeResizeAndDownsampleImage(Buffer.alloc(0), "image/png")).rejects.toThrow(
      ImageTooLargeError,
    );
  });

  it("compresses an oversized PNG, preferring PNG output and keeping dimensions", async () => {
    const result = await maybeResizeAndDownsampleImage(oversizedPng, "image/png");
    expect(result.mediaType).toBe("image/png");
    expect(result.byteLength).toBeLessThanOrEqual(MAX_IMAGE_BYTES_PASSTHROUGH);
    // The output must be a real decodable PNG; 1600px is already under the
    // cap and withoutEnlargement must not upscale it.
    const meta = await sharp(Buffer.from(result.data, "base64")).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1600);
  }, 30_000);

  it("compresses an oversized JPEG via the quality ladder and caps dimensions at 2000px", async () => {
    const result = await maybeResizeAndDownsampleImage(oversizedJpeg, "image/jpeg");
    expect(result.mediaType).toBe("image/jpeg");
    expect(result.byteLength).toBeLessThanOrEqual(MAX_IMAGE_BYTES_PASSTHROUGH);
    const meta = await sharp(Buffer.from(result.data, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(MAX_DIMENSION_PX);
    expect(meta.height).toBe(MAX_DIMENSION_PX);
  }, 30_000);

  it("round-trips the compressed payload as valid base64 binary", async () => {
    const result = await maybeResizeAndDownsampleImage(oversizedJpeg, "image/jpeg");
    const decoded = Buffer.from(result.data, "base64");
    expect(decoded.length).toBe(result.byteLength);
    expect(sniffMediaType(decoded)).toBe("image/jpeg");
  }, 30_000);

  it("throws ImageTooLargeError when sharp fails on an oversized corrupt buffer", async () => {
    // PNG magic followed by garbage: sniffable as an image, but sharp cannot
    // decode it. Over the passthrough target there is no valid fallback —
    // passing it through would exceed the 5MB base64 API limit (regression
    // test for the raw-vs-base64 fallback bug).
    const corrupt = Buffer.concat([
      PNG_MAGIC,
      Buffer.alloc(Math.floor(MAX_IMAGE_BYTES_PASSTHROUGH) + 1024, 0xab),
    ]);
    await expect(maybeResizeAndDownsampleImage(corrupt, "image/png")).rejects.toThrow(
      ImageTooLargeError,
    );
    await expect(maybeResizeAndDownsampleImage(corrupt, "image/png")).rejects.toThrow(
      /compression failed/,
    );
  });

  it("still passes a small corrupt buffer through (sharp never consulted)", async () => {
    const corrupt = Buffer.concat([PNG_MAGIC, Buffer.alloc(1024, 0xab)]);
    const result = await maybeResizeAndDownsampleImage(corrupt, "image/png");
    expect(result.data).toBe(corrupt.toString("base64"));
  });
});

describe("saveSessionImages", () => {
  it("writes binaries and returns refs", () => {
    const refs = saveSessionImages(workDir, "sess1", [createImageAttachment()]);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.path).toContain(join(".swifty", "sessions", "sess1", "images"));
    expect(refs[0]?.media_type).toBe("image/png");
    expect(refs[0]?.source_path).toBe("/tmp/original.png");
  });

  it("deduplicates identical content (content-addressed)", () => {
    const refs = saveSessionImages(workDir, "sess1", [
      createImageAttachment(),
      createImageAttachment(),
    ]);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.path).toBe(refs[1]?.path);
    const files = readdirSync(join(workDir, ".swifty", "sessions", "sess1", "images"));
    expect(files).toHaveLength(1);
  });
});

describe("loadImageRef", () => {
  it("round-trips base64 exactly", () => {
    const original = createImageAttachment();
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

describe("image block ↔ ref block round trip", () => {
  const DATA = Buffer.concat([PNG_MAGIC, Buffer.from("block-payload")]).toString("base64");
  const imageBlock = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: DATA },
  };
  const textBlock = { type: "text", text: "label" };

  it("persists image blocks as image_ref and passes other blocks through", () => {
    const out = imageBlocksToRefBlocks(workDir, "sess1", [textBlock, imageBlock]);
    expect(out[0]).toEqual(textBlock);
    expect(out[1].type).toBe("image_ref");
    expect(out[1].media_type).toBe("image/png");
    const path = out[1].path;
    if (typeof path !== "string") {
      throw new Error("expected ref path to be a string");
    }
    expect(readFileSync(path).toString("base64")).toBe(DATA);
  });

  it("deduplicates identical images (content-addressed)", () => {
    const out = imageBlocksToRefBlocks(workDir, "sess1", [imageBlock, { ...imageBlock }]);
    expect(out[0].path).toBe(out[1].path);
    const files = readdirSync(join(workDir, ".swifty", "sessions", "sess1", "images"));
    expect(files).toHaveLength(1);
  });

  it("restores refs to inline image blocks byte-identically", () => {
    const refs = imageBlocksToRefBlocks(workDir, "sess1", [textBlock, imageBlock]);
    const restored = refBlocksToImageBlocks(refs);
    expect(restored[0]).toEqual(textBlock);
    expect(restored[1]).toEqual(imageBlock);
  });

  it("degrades a missing binary to a text note", () => {
    const restored = refBlocksToImageBlocks([
      { type: "image_ref", path: join(workDir, "gone.png"), media_type: "image/png" },
    ]);
    expect(restored[0].type).toBe("text");
    expect(restored[0].text).toContain("could not be restored");
  });
});
