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

const log = createChildLogger({ module: "images" });

// On-disk reference persisted in session JSONL. The base64 payload never
// lands in the JSONL itself — binaries live under sessions/<id>/images/.
export interface ImageRef {
  path: string;
  media_type: string;
  source_path?: string | undefined;
}

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function imagesDir(workDir: string, sessionId: string): string {
  const id = sessionId || "default";
  return join(workDir, ".larky", "sessions", id, "images");
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
  const dir = imagesDir(workDir, sessionId);
  const refs: ImageRef[] = [];
  for (const img of images) {
    try {
      const buf = Buffer.from(img.data, "base64");
      const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      const ext = EXT_BY_MEDIA_TYPE[img.mediaType] ?? "png";
      const path = join(dir, `${hash}.${ext}`);
      if (!existsSync(path)) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, buf);
      }
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
