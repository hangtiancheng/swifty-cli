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

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { expandAtRefs, expandAtRefsWithImages } from "@/tui/at-expand.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("@file mention expansion", () => {
  it("inline a referenced file's contents", () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-"));
    writeFileSync(join(workDir, "notes.md"), "hello from notes");

    const out = expandAtRefs("please read @notes.md and summarize", workDir);
    expect(out).toContain("please read @notes.md and summarize");
    expect(out).toContain('<file path="notes.md">');
    expect(out).toContain("hello from notes");
  });

  it("leaves non-file @tokens untouched", () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-"));
    const text = "ping @alice about @nonexistent.txt";
    expect(expandAtRefs(text, workDir)).toBe(text);
  });

  it("returns the text unchanged when there are no @refs", () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-"));
    expect(expandAtRefs("just a plain message", workDir)).toBe("just a plain message");
  });

  it("de-duplicates repeated references", () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-"));
    writeFileSync(join(workDir, "a.txt"), "AAA");
    const out = expandAtRefs("@a.txt and again @a.txt", workDir);
    expect(out.match(/<file path="a.txt">/g)?.length).toBe(1);
  });
});

describe("@file mention expansion with images", () => {
  it("loads @image refs as attachments with a placeholder", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-img-"));
    const buf = Buffer.concat([PNG_MAGIC, Buffer.from("fake")]);
    writeFileSync(join(workDir, "shot.png"), buf);

    const out = await expandAtRefsWithImages("what is in @shot.png ?", workDir);
    expect(out.images).toHaveLength(1);
    expect(out.images[0]?.mediaType).toBe("image/png");
    expect(out.images[0]?.data).toBe(buf.toString("base64"));
    expect(out.text).toContain('<attached-image path="shot.png"/>');
    expect(out.text).not.toContain('<file path="shot.png">');
  });

  it("mixes image attachments and text file inlining", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-img-"));
    writeFileSync(join(workDir, "shot.png"), Buffer.concat([PNG_MAGIC, Buffer.from("x")]));
    writeFileSync(join(workDir, "notes.md"), "text notes");

    const out = await expandAtRefsWithImages("see @shot.png and @notes.md", workDir);
    expect(out.images).toHaveLength(1);
    expect(out.text).toContain('<attached-image path="shot.png"/>');
    expect(out.text).toContain('<file path="notes.md">');
    expect(out.text).toContain("text notes");
  });

  it("de-duplicates repeated image references", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-img-"));
    writeFileSync(join(workDir, "a.png"), Buffer.concat([PNG_MAGIC, Buffer.from("x")]));

    const out = await expandAtRefsWithImages("@a.png then @a.png", workDir);
    expect(out.images).toHaveLength(1);
  });

  it("degrades a non-image file with an image extension to an error note", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-img-"));
    writeFileSync(join(workDir, "fake.png"), "just text");

    const out = await expandAtRefsWithImages("look at @fake.png", workDir);
    expect(out.images).toHaveLength(0);
    expect(out.text).toContain('<file path="fake.png">Error:');
  });

  it("skips directories and leaves the token literal", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-img-"));
    mkdirSync(join(workDir, "imgs.png"));

    const out = await expandAtRefsWithImages("check @imgs.png", workDir);
    expect(out.images).toHaveLength(0);
    expect(out.text).toBe("check @imgs.png");
  });

  it("behaves like expandAtRefs for image-free input", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "larky-at-img-"));
    writeFileSync(join(workDir, "notes.md"), "hello");

    const sync = expandAtRefs("read @notes.md now", workDir);
    const withImages = await expandAtRefsWithImages("read @notes.md now", workDir);
    expect(withImages.text).toBe(sync);
    expect(withImages.images).toHaveLength(0);
  });
});
