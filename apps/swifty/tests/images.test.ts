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

import { afterEach, describe, expect, it, vi } from "vitest";
import { isImagePath, mediaTypeForPath, sniffMediaType } from "@/images/detect.js";
import {
  ImageTooLargeError,
  MAX_API_IMAGE_BYTES,
  MAX_IMAGE_BYTES_PASSTHROUGH,
} from "@/images/limits.js";
import { maybeResizeAndDownsampleImage } from "@/images/resize.js";

// Mock the sharp module: tests configure per-case behavior through sharpMock.
const sharpMock = vi.hoisted(() => vi.fn());
vi.mock("sharp", () => ({ default: sharpMock }));

interface MockSharpInstance {
  metadata: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  png: ReturnType<typeof vi.fn>;
  jpeg: ReturnType<typeof vi.fn>;
  toBuffer: ReturnType<typeof vi.fn>;
}

function mockInstance(overrides: Partial<MockSharpInstance> = {}): MockSharpInstance {
  const instance: MockSharpInstance = {
    metadata: vi.fn().mockResolvedValue({ width: 1000, height: 1000, format: "png" }),
    resize: vi.fn(),
    png: vi.fn(),
    jpeg: vi.fn(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1000)),
    ...overrides,
  };
  instance.resize.mockReturnValue(instance);
  if (!overrides.png) {
    instance.png.mockReturnValue(instance);
  }
  if (!overrides.jpeg) {
    instance.jpeg.mockReturnValue(instance);
  }
  return instance;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_MAGIC = Buffer.from("GIF89a", "ascii");
const WEBP_MAGIC = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4),
  Buffer.from("WEBP", "ascii"),
]);

function pngBuffer(totalSize: number): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.alloc(Math.max(0, totalSize - PNG_MAGIC.length))]);
}

afterEach(() => {
  sharpMock.mockReset();
});

describe("detect", () => {
  it("maps extensions to media types", () => {
    expect(mediaTypeForPath("a/b/shot.png")).toBe("image/png");
    expect(mediaTypeForPath("shot.JPG")).toBe("image/jpeg");
    expect(mediaTypeForPath("shot.jpeg")).toBe("image/jpeg");
    expect(mediaTypeForPath("anim.gif")).toBe("image/gif");
    expect(mediaTypeForPath("pic.webp")).toBe("image/webp");
    expect(mediaTypeForPath("doc.txt")).toBeNull();
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
});

describe("maybeResizeAndDownsampleImage", () => {
  it("passes small images through without invoking sharp", async () => {
    const buf = pngBuffer(1024);
    const result = await maybeResizeAndDownsampleImage(buf, "image/png");
    expect(result.data).toBe(buf.toString("base64"));
    expect(result.mediaType).toBe("image/png");
    expect(result.byteLength).toBe(1024);
    expect(sharpMock).not.toHaveBeenCalled();
  });

  it("rejects empty buffers", async () => {
    await expect(maybeResizeAndDownsampleImage(Buffer.alloc(0), "image/png")).rejects.toThrow(
      ImageTooLargeError,
    );
  });

  it("compresses oversized PNGs via sharp, preferring PNG output", async () => {
    const instance = mockInstance({
      metadata: vi.fn().mockResolvedValue({ width: 3000, height: 1500, format: "png" }),
      toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1000)),
    });
    sharpMock.mockReturnValue(instance);

    const buf = pngBuffer(MAX_API_IMAGE_BYTES + 1024);
    const result = await maybeResizeAndDownsampleImage(buf, "image/png");
    expect(result.mediaType).toBe("image/png");
    expect(result.byteLength).toBe(1000);
    // Dimension cap: 3000x1500 -> 2000x1000
    expect(instance.resize).toHaveBeenCalledWith(2000, 1000, {
      fit: "inside",
      withoutEnlargement: true,
    });
  });

  it("falls through PNG to the JPEG quality ladder", async () => {
    const big = Buffer.alloc(MAX_API_IMAGE_BYTES);
    const small = Buffer.alloc(1000);
    let jpegCalls = 0;
    const instance = mockInstance();
    instance.jpeg.mockImplementation(() => {
      jpegCalls++;
      return instance;
    });
    // PNG attempt returns big; second JPEG attempt (quality 60) fits.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    instance.toBuffer.mockImplementation(() => {
      return Promise.resolve(jpegCalls >= 2 ? small : big);
    });
    sharpMock.mockReturnValue(instance);

    const buf = pngBuffer(MAX_API_IMAGE_BYTES + 1024);
    const result = await maybeResizeAndDownsampleImage(buf, "image/png");
    expect(result.mediaType).toBe("image/jpeg");
    expect(instance.jpeg).toHaveBeenCalledWith({ quality: 80 });
    expect(instance.jpeg).toHaveBeenCalledWith({ quality: 60 });
  });

  it("throws when even the smallest ladder step is too large", async () => {
    const instance = mockInstance({
      toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(MAX_API_IMAGE_BYTES)),
    });
    sharpMock.mockReturnValue(instance);

    const buf = pngBuffer(MAX_API_IMAGE_BYTES + 1024);
    await expect(maybeResizeAndDownsampleImage(buf, "image/png")).rejects.toThrow(
      ImageTooLargeError,
    );
  });

  it("falls back to size check when sharp throws at runtime", async () => {
    const instance = mockInstance({
      metadata: vi.fn().mockRejectedValue(new Error("corrupt header")),
    });
    sharpMock.mockReturnValue(instance);

    // ~3.8MB: sharp fails but raw size is under the hard API limit -> passthrough
    const okSize = Math.floor(MAX_IMAGE_BYTES_PASSTHROUGH) + 1024;
    const ok = await maybeResizeAndDownsampleImage(pngBuffer(okSize), "image/png");
    expect(ok.byteLength).toBe(okSize);

    // >5MB: sharp fails and size is over -> error
    await expect(
      maybeResizeAndDownsampleImage(pngBuffer(MAX_API_IMAGE_BYTES + 1024), "image/png"),
    ).rejects.toThrow(ImageTooLargeError);
  });
});
