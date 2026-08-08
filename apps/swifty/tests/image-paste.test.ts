import { describe, expect, it } from "vitest";

import type { ImageAttachment } from "@/images/image.js";
import {
  appendPendingImageLabels,
  appendPendingImageLabelsToContent,
  appendPendingImagesToContent,
  buildPromptContent,
  canSubmitPrompt,
  createPendingImageState,
  formatImageLabel,
  formatPendingImageLabels,
  isImagePasteShortcut,
  pendingImageReducer,
  pendingImagesToContentBlocks,
  type PendingImage,
} from "@/images/paste.js";

const attachment: ImageAttachment = {
  mediaType: "image/png",
  data: "QUJD",
  byteLength: 3,
};

function image(id: number): PendingImage {
  return { id, attachment };
}

describe("image paste prompt helpers", () => {
  it("formats stable labels and appends them to model text", () => {
    const images = [image(1), image(3)];

    expect(formatImageLabel(3)).toBe("[Image #3]");
    expect(formatPendingImageLabels(images)).toBe("[Image #1] [Image #3]");
    expect(appendPendingImageLabels("compare these", images)).toBe(
      "compare these\n\n[Image #1] [Image #3]",
    );
    expect(appendPendingImageLabels("", images)).toBe("[Image #1] [Image #3]");
  });

  it("converts pending images to provider-style image blocks", () => {
    expect(pendingImagesToContentBlocks([image(1)])).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "QUJD" },
      },
    ]);

    expect(buildPromptContent({ text: "look", images: [image(1)] })).toEqual([
      { type: "text", text: "look\n\n[Image #1]" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "QUJD" },
      },
    ]);
    expect(buildPromptContent({ text: "plain", images: [] })).toBe("plain");
  });

  it("appends clipboard images without replacing existing @image blocks", () => {
    const existingImageBlock = {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "REVG" },
    };
    const existingContent = [{ type: "text", text: "expanded @photo.jpg" }, existingImageBlock];

    expect(appendPendingImagesToContent(existingContent, [image(2)])).toEqual([
      ...existingContent,
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "QUJD" },
      },
    ]);
    expect(appendPendingImagesToContent("plain text", [image(2)])).toEqual([
      { type: "text", text: "plain text" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "QUJD" },
      },
    ]);
    expect(appendPendingImagesToContent(existingContent, [])).toBe(existingContent);
  });

  it("keeps @image placeholders and blocks before clipboard labels and blocks", () => {
    const existingImageBlock = {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "REVG" },
    };
    const expandedContent = [
      {
        type: "text",
        text: 'compare @photo.jpg\n\n<image type="base64" path="photo.jpg" />',
      },
      existingImageBlock,
    ];

    const labeled = appendPendingImageLabelsToContent(expandedContent, [image(2)]);
    expect(labeled).toEqual([
      {
        type: "text",
        text: 'compare @photo.jpg\n\n<image type="base64" path="photo.jpg" />\n\n[Image #2]',
      },
      existingImageBlock,
    ]);
    expect(appendPendingImagesToContent(labeled, [image(2)])).toEqual([
      labeled[0],
      existingImageBlock,
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "QUJD" },
      },
    ]);
  });

  it("allows image-only prompts but rejects a fully empty draft", () => {
    expect(canSubmitPrompt("", [image(1)])).toBe(true);
    expect(canSubmitPrompt("  ", [])).toBe(false);
  });
});

describe("pending image reducer", () => {
  it("keeps IDs monotonic across deletion and accepted submissions", () => {
    let state = createPendingImageState();
    state = pendingImageReducer(state, { type: "add", attachment });
    expect(state.images.map((item) => item.id)).toEqual([1]);

    state = pendingImageReducer(state, { type: "remove-last" });
    state = pendingImageReducer(state, { type: "add", attachment });
    expect(state.images.map((item) => item.id)).toEqual([2]);

    state = pendingImageReducer(state, { type: "submission-result", accepted: true });
    expect(state.images).toEqual([]);
    state = pendingImageReducer(state, { type: "add", attachment });
    expect(state.images.map((item) => item.id)).toEqual([3]);
  });

  it("preserves the exact pending state when submission is rejected", () => {
    const state = pendingImageReducer(createPendingImageState(), {
      type: "add",
      attachment,
    });
    expect(pendingImageReducer(state, { type: "submission-result", accepted: false })).toBe(state);
  });
});

describe("image paste shortcut", () => {
  const ctrl = { ctrl: true, meta: false };
  const alt = { ctrl: false, meta: true };
  const plain = { ctrl: false, meta: false };

  it("uses Ctrl+V on macOS and Linux", () => {
    expect(isImagePasteShortcut("v", ctrl, "darwin")).toBe(true);
    expect(isImagePasteShortcut("v", ctrl, "linux")).toBe(true);
    expect(isImagePasteShortcut("v", alt, "darwin")).toBe(false);
  });

  it("uses Alt+V (Ink meta) on Windows", () => {
    expect(isImagePasteShortcut("v", alt, "win32")).toBe(true);
    expect(isImagePasteShortcut("v", ctrl, "win32")).toBe(false);
  });

  it("does not consume plain or shifted V", () => {
    expect(isImagePasteShortcut("v", plain, "linux")).toBe(false);
    expect(isImagePasteShortcut("V", ctrl, "linux")).toBe(false);
  });
});
