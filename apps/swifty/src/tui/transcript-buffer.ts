import type { ChatMessage, ToolSummaryItem } from "./chat.js";

export const MAX_TRANSCRIPT_MESSAGES = 200;
export const MAX_TRANSCRIPT_CHARS = 200_000;

const REPLAY_TRUNCATION = "\n… truncated for replay";

function takeText(text: string, remaining: number): string {
  if (remaining <= 0) {
    return "";
  }
  if (text.length <= remaining) {
    return text;
  }
  if (remaining <= REPLAY_TRUNCATION.length) {
    return REPLAY_TRUNCATION.slice(0, remaining);
  }
  return text.slice(0, remaining - REPLAY_TRUNCATION.length) + REPLAY_TRUNCATION;
}

function messageChars(message: ChatMessage): number {
  let total = message.content.length;
  for (const tool of message.toolSummary ?? []) {
    total += tool.toolName.length + tool.argsSummary.length + tool.output.length;
  }
  return total;
}

function fitMessage(message: ChatMessage, limit: number): ChatMessage {
  if (messageChars(message) <= limit) {
    return message;
  }

  let remaining = limit;
  const content = takeText(message.content, remaining);
  remaining -= content.length;

  let toolSummary: ToolSummaryItem[] | undefined;
  if (message.toolSummary) {
    toolSummary = [];
    for (const tool of message.toolSummary) {
      if (remaining <= 0) {
        break;
      }
      const toolName = takeText(tool.toolName, remaining);
      remaining -= toolName.length;
      const argsSummary = takeText(tool.argsSummary, remaining);
      remaining -= argsSummary.length;
      const output = takeText(tool.output, remaining);
      remaining -= output.length;
      toolSummary.push({ ...tool, toolName, argsSummary, output });
    }
  }

  return { ...message, content, toolSummary };
}

export class TranscriptBuffer {
  private messages: ChatMessage[] = [];
  private charCount = 0;

  append(incoming: ChatMessage[]): void {
    for (const message of incoming) {
      const retained = fitMessage(message, MAX_TRANSCRIPT_CHARS);
      this.messages.push(retained);
      this.charCount += messageChars(retained);

      while (
        this.messages.length > MAX_TRANSCRIPT_MESSAGES ||
        this.charCount > MAX_TRANSCRIPT_CHARS
      ) {
        const removed = this.messages.shift();
        if (!removed) {
          break;
        }
        this.charCount -= messageChars(removed);
      }
    }
  }

  replace(messages: ChatMessage[]): void {
    this.clear();
    this.append(messages);
  }

  clear(): void {
    this.messages = [];
    this.charCount = 0;
  }

  snapshot(): ChatMessage[] {
    return [...this.messages];
  }

  retainedChars(): number {
    return this.charCount;
  }
}
