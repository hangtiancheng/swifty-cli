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

import sharp from "sharp";
import { createChildLogger } from "@/logger/index.js";
import {
  ImageTooLargeError,
  JPEG_QUALITY_LADDER,
  MAX_API_IMAGE_BYTES,
  MAX_DIMENSION_PX,
  MAX_IMAGE_BYTES_PASSTHROUGH,
} from "./limits.js";
import type { ImageMediaType } from "./types.js";

const log = createChildLogger({ module: "images" });

export interface ResizedImage {
  data: string;
  mediaType: ImageMediaType;
  byteLength: number;
}

function toResult(buf: Buffer, mediaType: ImageMediaType): ResizedImage {
  return { data: buf.toString("base64"), mediaType, byteLength: buf.length };
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Resize/compress an image buffer so its base64 encoding fits the API limit.
// Mirrors claude-code's maybeResizeAndDownsampleImageBuffer strategy:
//   1. <=3.75MB raw passes through untouched (sharp never invoked).
//   2. Otherwise: cap dimensions at 2000px, keep PNG when possible
//      (compressionLevel 9), then walk the JPEG quality ladder 80/60/40/20,
//      then halve dimensions and retry (max twice).
// GIF/WebP are re-encoded to PNG/JPEG only when they need compression, which
// also normalizes animated GIFs to their first frame.
export async function maybeResizeAndDownsampleImage(
  buf: Buffer,
  mediaType: ImageMediaType,
): Promise<ResizedImage> {
  if (buf.length === 0) {
    throw new ImageTooLargeError("Image file is empty (0 bytes)");
  }
  if (buf.length <= MAX_IMAGE_BYTES_PASSTHROUGH) {
    return toResult(buf, mediaType);
  }

  try {
    return await compressWithSharp(buf, mediaType);
  } catch (err) {
    if (err instanceof ImageTooLargeError) {
      throw err;
    }
    // sharp failed at runtime (corrupt file, unsupported variant, ...) —
    // pass the original through if it can still fit under the hard limit.
    log.warn({ err }, "sharp compression failed, falling back to size check");
    if (buf.length <= MAX_API_IMAGE_BYTES) {
      return toResult(buf, mediaType);
    }
    throw new ImageTooLargeError(
      `Image is ${formatMB(buf.length)} (API limit ${formatMB(MAX_API_IMAGE_BYTES)} base64-encoded) ` +
        `and compression failed. Please provide a smaller image.`,
    );
  }
}

async function compressWithSharp(buf: Buffer, mediaType: ImageMediaType): Promise<ResizedImage> {
  const metadata = await sharp(buf).metadata();
  let width = metadata.width ?? MAX_DIMENSION_PX;
  let height = metadata.height ?? MAX_DIMENSION_PX;

  if (width > MAX_DIMENSION_PX) {
    height = Math.max(1, Math.round((height * MAX_DIMENSION_PX) / width));
    width = MAX_DIMENSION_PX;
  }
  if (height > MAX_DIMENSION_PX) {
    width = Math.max(1, Math.round((width * MAX_DIMENSION_PX) / height));
    height = MAX_DIMENSION_PX;
  }

  const preservePng = mediaType === "image/png" || mediaType === "image/gif";

  // Halve dimensions and retry the whole ladder at most twice.
  for (let attempt = 0; attempt < 3; attempt++) {
    // IMPORTANT: create a fresh sharp(buf) per operation — reusing an
    // instance after toBuffer() does not re-apply format conversions.
    if (preservePng) {
      const png = await sharp(buf)
        .resize(width, height, { fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();
      if (png.length <= MAX_IMAGE_BYTES_PASSTHROUGH) {
        return toResult(png, "image/png");
      }
    }
    for (const quality of JPEG_QUALITY_LADDER) {
      const jpeg = await sharp(buf)
        .resize(width, height, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      if (jpeg.length <= MAX_IMAGE_BYTES_PASSTHROUGH) {
        return toResult(jpeg, "image/jpeg");
      }
    }
    width = Math.max(1, Math.round(width / 2));
    height = Math.max(1, Math.round(height / 2));
  }

  throw new ImageTooLargeError(
    `Unable to compress image (${formatMB(buf.length)} raw) under the ` +
      `${formatMB(MAX_API_IMAGE_BYTES)} API limit. Please provide a smaller image.`,
  );
}
