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

// Corresponds to chat_pipeline (orchestration.go, prompt.go, flow.go).
// RAG retrieval + system prompt + ReAct agent (streamText/generateText with tools + maxSteps).
import { streamText, generateText, type Tool, type ModelMessage, isStepCount } from "ai";
import { quickModel, providerOptions } from "../models";
import { builtinTools } from "../tools";
import { getLogMcpTools } from "../tools/query-log";
import { retrieve } from "@/lib/redis/retriever";
import { getSimpleMemory } from "@/lib/memory";

// P3-5 fix: read log topic config from env vars instead of hardcoding
// region/id in the system prompt.
const LOG_TOPIC_REGION = process.env.LOG_TOPIC_REGION ?? "";
const LOG_TOPIC_ID = process.env.LOG_TOPIC_ID ?? "";
const logTopicLine =
  LOG_TOPIC_REGION && LOG_TOPIC_ID
    ? `  • Log topic region: ${LOG_TOPIC_REGION}; log topic id: ${LOG_TOPIC_ID}`
    : "";

// System prompt migrated from chat_pipeline/prompt.go.
const SYSTEM_PROMPT = `# Role: Conversational Assistant
## Core capabilities
- Context understanding and conversation
- Search the web for information
## Interaction guidelines
- Before replying, ensure you:
  • Fully understand the user's needs and questions; confirm with the user if anything is unclear
  • Consider the most appropriate solution approach
${logTopicLine}
- When providing help:
  • Use clear and concise language
  • Provide practical examples when appropriate
  • Reference documentation when helpful
  • Suggest improvements or next steps when applicable
- If a request is beyond your capabilities:
  • Clearly state your limitations and, if possible, suggest alternative approaches
- For complex or compound questions, think step by step and avoid giving low-quality answers directly.
## Output requirements:
  • Readable and well-structured, with line breaks when needed
  • Output markdown only
## Context information
- Current date: {date}
- Relevant documents: |-
==== Documents start ====
  {documents}
==== Documents end ====
`;

function buildSystemPrompt(documents: string): string {
  return SYSTEM_PROMPT.replace("{date}", new Date().toLocaleString("en-US")).replace(
    "{documents}",
    documents,
  );
}

async function buildChatTools(): Promise<Record<string, Tool>> {
  const mcpTools = await getLogMcpTools();
  return { ...mcpTools, ...builtinTools };
}

// Non-streaming chat (corresponds to the Chat controller).
export async function chat(id: string, question: string): Promise<string> {
  const mem = getSimpleMemory(id);
  const history = mem.getMessages();
  const docs = await retrieve(question);
  const documents = docs.map((d) => d.content).join("\n");
  const tools = await buildChatTools();

  const result = await generateText({
    model: quickModel,
    system: buildSystemPrompt(documents),
    messages: [...history, { role: "user", content: question } satisfies ModelMessage],
    tools,
    stopWhen: isStepCount(25),
    providerOptions,
  });

  const answer = result.text;
  mem.setMessages({ role: "user", content: question });
  mem.setMessages({ role: "assistant", content: answer });
  return answer;
}

// Streaming chat (corresponds to the ChatStream controller). Yields text chunks.
// Memory is persisted after the stream completes.
export async function* chatStream(id: string, question: string): AsyncGenerator<string> {
  const mem = getSimpleMemory(id);
  const history = mem.getMessages();
  const docs = await retrieve(question);
  const documents = docs.map((d) => d.content).join("\n");
  const tools = await buildChatTools();

  const result = streamText({
    model: quickModel,
    system: buildSystemPrompt(documents),
    messages: [...history, { role: "user", content: question } satisfies ModelMessage],
    tools,
    stopWhen: isStepCount(25),
    providerOptions,
  });

  let full = "";
  try {
    for await (const chunk of result.textStream) {
      full += chunk;
      yield chunk;
    }
  } finally {
    if (full) {
      mem.setMessages({ role: "user", content: question });
      mem.setMessages({ role: "assistant", content: full });
    }
  }
}
