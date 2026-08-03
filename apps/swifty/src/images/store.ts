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

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { asImageMediaType, type ImageAttachment } from "./types.js";

import { createChildLogger } from "@/logger/index.js";
import { isRecord } from "@/utils/index.js";

const log = createChildLogger({ module: "images" });

// On-disk reference persisted in session JSONL. The base64 payload never
// lands in the JSONL itself — binaries live under sessions/<id>/images/.
export interface ImageRef {
  path: string;
  media_type: string;
  source_path?: string | undefined;
}

const extNoDotByMediaType: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function imagesDir(workDir: string, sessionId: string): string {
  const id = sessionId || "default";
  return join(workDir, ".swifty", "sessions", id, "images");
}

// Content-addressed write shared by attachment- and block-level persistence.
// Throws on I/O failure; callers decide how to degrade.
function persistImageBinary(
  workDir: string,
  sessionId: string,
  base64: string,
  mediaType: string,
): string {
  const buf = Buffer.from(base64, "base64");
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const ext = extNoDotByMediaType[mediaType] ?? "png";
  const dir = imagesDir(workDir, sessionId);
  const path = join(dir, `${hash}.${ext}`);
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, buf);
  }
  return path;
}

// Write image binaries to the session images dir, content-addressed by
// sha256 so re-attaching the same image is idempotent and deduplicated.
// A failed write skips that image (it stays in memory for this run) rather
// than failing the save.
export function saveSessionImages(
  workDir: string,
  sessionId: string,
  images: ImageAttachment[],
): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const img of images) {
    try {
      const path = persistImageBinary(workDir, sessionId, img.data, img.mediaType);
      refs.push({
        path,
        media_type: img.mediaType,
        ...(img.sourcePath ? { source_path: img.sourcePath } : {}),
      });
    } catch (err) {
      log.error({ err }, "failed to persist session image");
    }
  }
  return refs;
}

/** Persisted stand-in for an inline image block inside tool-result content. */
export const IMAGE_REF_TYPE = "image_ref";

// Provider-style image blocks ({type:"image", source:{type:"base64", ...}}) →
// persisted ref blocks ({type:"image_ref", path, media_type}); the binary
// lands under sessions/<id>/images/ so base64 never bloats the JSONL.
// Non-image blocks pass through untouched. On write failure the inline block
// is kept as-is (the line stays large but no data is lost).
export function imageBlocksToRefBlocks(
  workDir: string,
  sessionId: string,
  blocks: Record<string, unknown>[],
): Record<string, unknown>[] {
  return blocks.map((block) => {
    if (block.type !== "image" || !isRecord(block.source) || block.source.type !== "base64") {
      return block;
    }
    const data = block.source.data;
    const mediaType = block.source.media_type;
    if (typeof data !== "string" || typeof mediaType !== "string") {
      return block;
    }
    try {
      const path = persistImageBinary(workDir, sessionId, data, mediaType);
      return { type: IMAGE_REF_TYPE, path, media_type: mediaType };
    } catch (err) {
      log.error({ err }, "failed to persist session image");
      return block;
    }
  });
}

// Inverse of imageBlocksToRefBlocks, applied on session restore. A missing or
// unreadable binary degrades to a text note so the model isn't silently
// confused by a dangling tool result.
export function refBlocksToImageBlocks(
  blocks: Record<string, unknown>[],
): Record<string, unknown>[] {
  return blocks.map((block) => {
    if (block.type !== IMAGE_REF_TYPE || typeof block.path !== "string") {
      return block;
    }
    try {
      const buf = readFileSync(block.path);
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: typeof block.media_type === "string" ? block.media_type : "image/png",
          data: buf.toString("base64"),
        },
      };
    } catch (err) {
      log.warn({ err, path: block.path }, "failed to restore session image");
      return { type: "text", text: "[note: an image from this tool result could not be restored]" };
    }
  });
}

// Restore an image from its session ref. Returns null when the file is
// missing or unreadable — callers drop the image and keep a placeholder.
export function loadImageRef(ref: ImageRef): ImageAttachment | null {
  try {
    const buf = readFileSync(ref.path);
    return {
      mediaType: asImageMediaType(ref.media_type),
      data: buf.toString("base64"),
      sourcePath: ref.source_path,
      byteLength: buf.length,
    };
  } catch (err) {
    log.warn({ err, path: ref.path }, "failed to restore session image");
    return null;
  }
}
