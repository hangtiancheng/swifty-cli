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

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveSessionImages } from "@/images/store.js";
import type { ImageAttachment } from "@/images/types.js";
import {
  getSessionFilePath,
  loadSession,
  newSessionId,
  rebuildFromSession,
  saveCompactBoundary,
  saveMessage,
  sessionCtxFromFilePath,
  toolResultsToRecords,
} from "@/session/session.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function img(): ImageAttachment {
  const buf = Buffer.concat([PNG_MAGIC, Buffer.from("payload")]);
  return {
    mediaType: "image/png",
    data: buf.toString("base64"),
    sourcePath: "/tmp/shot.png",
    byteLength: buf.length,
  };
}

let workDir: string;
const t0 = 1_700_000_000;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "larky-session-img-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("session image persistence", () => {
  it("loads legacy JSONL lines without images fields (backward compatible)", () => {
    const id = newSessionId();
    // Simulate a pre-images session file written by an older build.
    mkdirSync(join(workDir, ".larky", "sessions"), { recursive: true });
    appendFileSync(
      getSessionFilePath(workDir, id),
      JSON.stringify({ role: "user", content: "old message", timestamp: t0 }) + "\n",
    );
    const rebuilt = rebuildFromSession(loadSession(workDir, id));
    expect(rebuilt).toEqual([{ role: "user", content: "old message" }]);
  });

  it("round-trips a user message with image refs", () => {
    const id = newSessionId();
    const original = img();
    const refs = saveSessionImages(workDir, id, [original]);
    saveMessage(workDir, id, {
      role: "user",
      content: "look at @shot.png",
      timestamp: t0,
      images: refs,
    });

    const rebuilt = rebuildFromSession(loadSession(workDir, id));
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]?.images).toHaveLength(1);
    expect(rebuilt[0]?.images?.[0]?.data).toBe(original.data);
    expect(rebuilt[0]?.images?.[0]?.mediaType).toBe("image/png");
  });

  it("round-trips tool_result image refs", () => {
    const id = newSessionId();
    const records = toolResultsToRecords(
      [{ toolUseId: "t1", content: "[image: shot.png]", isError: false, images: [img()] }],
      { workDir, sessionId: id },
    );
    saveMessage(workDir, id, {
      role: "user",
      content: "",
      timestamp: t0,
      tool_results: records,
    });

    const rebuilt = rebuildFromSession(loadSession(workDir, id));
    expect(rebuilt[0]?.toolResults?.[0]?.images).toHaveLength(1);
    expect(rebuilt[0]?.toolResults?.[0]?.images?.[0]?.data).toBe(img().data);
  });

  it("drops missing image binaries with a note instead of crashing", () => {
    const id = newSessionId();
    const refs = saveSessionImages(workDir, id, [img()]);
    saveMessage(workDir, id, {
      role: "user",
      content: "look",
      timestamp: t0,
      images: refs,
    });
    unlinkSync(refs[0].path);

    const rebuilt = rebuildFromSession(loadSession(workDir, id));
    expect(rebuilt[0]?.images).toBeUndefined();
    expect(rebuilt[0]?.content).toContain("1 image(s) from this message could not be restored");
  });

  it("restores images from a compact boundary keep tail", () => {
    const id = newSessionId();
    const original = img();
    const refs = saveSessionImages(workDir, id, [original]);
    saveCompactBoundary(workDir, id, {
      summary: "earlier chat",
      keep: [{ role: "user", content: "kept with image", images: refs }],
    });

    const rebuilt = rebuildFromSession(loadSession(workDir, id));
    // [0] = synthetic summary user message, [1] = kept message
    expect(rebuilt[1]?.content).toBe("kept with image");
    expect(rebuilt[1]?.images?.[0]?.data).toBe(original.data);
  });

  it("does not drop an image-only message (empty content) on resume", () => {
    const id = newSessionId();
    const original = img();
    const refs = saveSessionImages(workDir, id, [original]);
    saveMessage(workDir, id, {
      role: "user",
      content: "",
      timestamp: t0,
      images: refs,
    });

    const rebuilt = rebuildFromSession(loadSession(workDir, id));
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]?.images?.[0]?.data).toBe(original.data);
  });

  it("does not drop an image-only kept message from a compact boundary", () => {
    const id = newSessionId();
    const original = img();
    const refs = saveSessionImages(workDir, id, [original]);
    saveCompactBoundary(workDir, id, {
      summary: "earlier chat",
      keep: [{ role: "user", content: "", images: refs }],
    });

    const rebuilt = rebuildFromSession(loadSession(workDir, id));
    // [0] = synthetic summary user message, [1] = image-only kept message
    expect(rebuilt).toHaveLength(2);
    expect(rebuilt[1]?.images?.[0]?.data).toBe(original.data);
  });
});

describe("sessionCtxFromFilePath", () => {
  it("inverts getSessionFilePath", () => {
    const id = newSessionId();
    const ctx = sessionCtxFromFilePath(getSessionFilePath(workDir, id));
    expect(ctx).toEqual({ workDir, sessionId: id });
  });

  it("returns null for non-session paths", () => {
    expect(sessionCtxFromFilePath("/tmp/random.jsonl")).toBeNull();
    expect(sessionCtxFromFilePath("/tmp/.larky/sessions/abc.txt")).toBeNull();
    expect(sessionCtxFromFilePath("")).toBeNull();
  });
});
