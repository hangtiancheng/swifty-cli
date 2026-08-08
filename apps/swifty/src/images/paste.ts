import type { Key } from "ink";

import { MAX_IMAGES_PER_MESSAGE, type ImageAttachment } from "./image.js";

export interface PendingImage {
  id: number;
  attachment: ImageAttachment;
}

export interface PromptSubmission {
  text: string;
  images: readonly PendingImage[];
}

export interface PendingImageState {
  images: PendingImage[];
  nextId: number;
}

export type PendingImageAction =
  | { type: "add"; attachment: ImageAttachment }
  | { type: "remove-last" }
  | { type: "submission-result"; accepted: boolean };

export function createPendingImageState(nextId = 1): PendingImageState {
  return { images: [], nextId };
}

export function pendingImageReducer(
  state: PendingImageState,
  action: PendingImageAction,
): PendingImageState {
  switch (action.type) {
    case "add": {
      if (state.images.length >= MAX_IMAGES_PER_MESSAGE) {
        return state;
      }
      return {
        images: [...state.images, { id: state.nextId, attachment: action.attachment }],
        nextId: state.nextId + 1,
      };
    }
    case "remove-last": {
      if (state.images.length === 0) {
        return state;
      }
      return { ...state, images: state.images.slice(0, -1) };
    }
    case "submission-result": {
      return action.accepted && state.images.length > 0 ? { ...state, images: [] } : state;
    }
  }
}

export function formatImageLabel(id: number): string {
  return `[Image #${String(id)}]`;
}

export function formatPendingImageLabels(images: readonly PendingImage[]): string {
  return images.map((image) => formatImageLabel(image.id)).join(" ");
}

export function appendPendingImageLabels(text: string, images: readonly PendingImage[]): string {
  const labels = formatPendingImageLabels(images);
  if (!labels) {
    return text;
  }
  return text ? `${text}\n\n${labels}` : labels;
}

export function appendPendingImageLabelsToContent(
  content: string | Record<string, unknown>[],
  images: readonly PendingImage[],
): string | Record<string, unknown>[] {
  if (images.length === 0) {
    return content;
  }
  if (typeof content === "string") {
    return appendPendingImageLabels(content, images);
  }

  const textIndex = content.findIndex(
    (block) => block.type === "text" && typeof block.text === "string",
  );
  if (textIndex < 0) {
    return [{ type: "text", text: formatPendingImageLabels(images) }, ...content];
  }
  return content.map((block, index) => {
    if (index !== textIndex || typeof block.text !== "string") {
      return block;
    }
    return {
      ...block,
      text: appendPendingImageLabels(block.text, images),
    };
  });
}

export function pendingImagesToContentBlocks(
  images: readonly PendingImage[],
): Record<string, unknown>[] {
  return images.map(({ attachment }) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: attachment.mediaType,
      data: attachment.data,
    },
  }));
}

export function appendPendingImagesToContent(
  content: string | Record<string, unknown>[],
  images: readonly PendingImage[],
): string | Record<string, unknown>[] {
  if (images.length === 0) {
    return content;
  }

  const imageBlocks = pendingImagesToContentBlocks(images);
  return typeof content === "string"
    ? [{ type: "text", text: content }, ...imageBlocks]
    : [...content, ...imageBlocks];
}

export function buildPromptContent(
  submission: PromptSubmission,
): string | Record<string, unknown>[] {
  if (submission.images.length === 0) {
    return submission.text;
  }
  return appendPendingImagesToContent(
    appendPendingImageLabelsToContent(submission.text, submission.images),
    submission.images,
  );
}

export function canSubmitPrompt(text: string, images: readonly PendingImage[]): boolean {
  return text.trim().length > 0 || images.length > 0;
}

export function isImagePasteShortcut(
  input: string,
  key: Pick<Key, "ctrl" | "meta">,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (input !== "v") {
    return false;
  }
  return platform === "win32" ? key.meta : key.ctrl;
}
