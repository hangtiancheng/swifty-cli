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

import { readFileSync, statSync } from "node:fs";

import { sniffMediaType } from "./detect.js";
import { maybeResizeAndDownsampleImage } from "./resize.js";
import type { ImageAttachment } from "./types.js";

// Read an image file, validate its real format via magic bytes, and compress
// it to fit API limits. Throws with context on any failure (caller decides
// how to degrade).
export async function loadImageAttachment(absPath: string): Promise<ImageAttachment> {
  const st = statSync(absPath);
  if (!st.isFile()) {
    throw new Error(`Not a file: ${absPath}`);
  }
  const buf = readFileSync(absPath);

  const sniffed = sniffMediaType(buf);
  if (!sniffed) {
    throw new Error(
      `File ${absPath} has an image extension but its contents are not a supported image format (png/jpeg/gif/webp)`,
    );
  }
  // Magic bytes win over the extension when they disagree.
  const resized = await maybeResizeAndDownsampleImage(buf, sniffed);
  return {
    mediaType: resized.mediaType,
    data: resized.data,
    sourcePath: absPath,
    byteLength: resized.byteLength,
  };
}
