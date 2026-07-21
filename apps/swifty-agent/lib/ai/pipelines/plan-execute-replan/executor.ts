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

// Step executor
// Uses AI SDK generateText with tools + stopWhen for multi-step tool execution
// within a single plan step.
import { generateText, isStepCount, type Tool } from "ai";
import { quickModel, providerOptions } from "../../models";

export interface StepResult {
  text: string;
}

// P2-17 fix: pass providerOptions so Anthropic extended thinking is
// consistently enabled for step execution (same as chat & planner).
export async function executeStep(step: string, tools: Record<string, Tool>): Promise<StepResult> {
  const result = await generateText({
    model: quickModel,
    prompt: step,
    tools,
    stopWhen: isStepCount(10),
    providerOptions,
  });
  return { text: result.text };
}
