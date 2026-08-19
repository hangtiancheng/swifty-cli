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

// A2UI action pipeline: a surface action (button click) is answered with
// updateComponents/updateDataModel messages for the SAME surface, which the
// client appends to that surface's message list — the A2uiView applies them
// in place. No user chat message is involved.
import { generateText, isStepCount, type ModelMessage } from "ai";
import { quickModel, providerOptions } from "../models";
import { builtinTools } from "../tools";
import { getLogMcpTools } from "../tools/query-log";
import { correctA2uiBlock } from "./correct";
import { extractA2ui } from "./extract";
import {
  A2UI_ACTION_SYSTEM_PROMPT,
  buildA2uiActionPrompt,
  type A2uiActionPayload,
} from "./prompt";

export interface A2uiActionResult {
  a2ui?: unknown[];
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Keeps only messages the renderer can apply to the existing surface:
// updateComponents/updateDataModel targeting the action's surfaceId. A stray
// createSurface would make the client-side MessageProcessor throw ("Surface
// already exists") and drop the whole batch.
function filterInPlaceMessages(
  messages: unknown[],
  surfaceId: string,
): unknown[] {
  return messages.filter((message) => {
    if (!isRecord(message)) return false;
    const payload = message.updateComponents ?? message.updateDataModel;
    return isRecord(payload) && payload.surfaceId === surfaceId;
  });
}

export async function runA2uiAction(
  action: A2uiActionPayload,
  surfaceMessages: unknown[],
): Promise<A2uiActionResult> {
  const mcpTools = await getLogMcpTools();
  const tools = { ...mcpTools, ...builtinTools };
  const question = buildA2uiActionPrompt(action, surfaceMessages);

  const result = await generateText({
    model: quickModel,
    system: A2UI_ACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: question } satisfies ModelMessage],
    tools,
    stopWhen: isStepCount(10),
    providerOptions,
  });

  const extracted = extractA2ui(result.text);
  let messages = extracted.messages;
  if (!messages) {
    messages = await correctA2uiBlock({
      model: quickModel,
      system: A2UI_ACTION_SYSTEM_PROMPT,
      history: [],
      question,
      rawAnswer: result.text,
      error: extracted.error ?? "no A2UI block found",
    });
  }
  if (!messages) {
    return { error: "model did not return a valid A2UI block" };
  }

  const inPlace = filterInPlaceMessages(messages, action.surfaceId);
  if (inPlace.length === 0) {
    return {
      error: `no in-place update messages for surface ${action.surfaceId}`,
    };
  }
  return { a2ui: inPlace };
}
