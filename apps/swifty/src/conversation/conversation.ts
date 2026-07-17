/**
 * Status: Done
 */

export interface ToolUseBlock {
  toolUseId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultBlock {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface ThinkingBlock {
  thinking: string;
  signature: string;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  thinkingBlocks?: ThinkingBlock[] | undefined;
  toolUses?: ToolUseBlock[] | undefined;
  toolResults?: ToolResultBlock[] | undefined;
}

export class ConversationManager {
  private history: Message[] = [];
  private longTermMemoryInjected = false;
  private baselineTokens = 0;
  private _anchorCount = 0;

  addUserMessage(content: string): void {
    this.history.push({ role: "user", content });
  }

  addAssistantMessage(content: string): void {
    this.history.push({ role: "assistant", content });
  }

  addToolUseMessage(
    text: string,
    toolUseId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void {
    this.history.push({
      role: "assistant",
      content: text,
      toolUses: [{ toolUseId, toolName, arguments: args }],
    });
  }

  addAssistantMessageWithTools(text: string, toolUses: ToolUseBlock[]): void {
    this.history.push({ role: "assistant", content: text, toolUses });
  }

  addAssistantFull(text: string, thinking: ThinkingBlock[], toolUses: ToolUseBlock[]): void {
    this.history.push({
      role: "assistant",
      content: text,
      thinkingBlocks: thinking.length > 0 ? thinking : undefined,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
    });
  }

  addToolResultMessage(toolUseId: string, content: string, isError: boolean): void {
    this.history.push({
      role: "user",
      content: "",
      toolResults: [{ toolUseId, content, isError }],
    });
  }

  addToolResultsMessage(results: ToolResultBlock[]): void {
    this.history.push({
      role: "user",
      content: "",
      toolResults: results,
    });
  }

  addSystemReminder(content: string): void {
    this.history.push({
      role: "user",
      content: `<system-reminder>\n${content}\n</system-reminder>`,
    });
  }

  injectLongTermMemory(instructions: string, memories: string): void {
    if (this.longTermMemoryInjected) {
      return;
    }
    const sections: string[] = [];
    if (instructions) {
      sections.push(
        "# SWIFTY.md\nCodebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n" +
          instructions,
      );
    }
    if (memories) {
      sections.push("# Auto Memory\n" + memories);
    }
    if (sections.length === 0) {
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    sections.push("# Current Date\nToday's date is " + today + ".");
    const body = sections.join("\n\n");
    const wrapped = `
<system-reminder>
  As you answer the user's questions, you can use the following context:
  \n${body}\n
  IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>`;

    this.history.unshift({ role: "user", content: wrapped });
    this.longTermMemoryInjected = true;
  }

  len(): number {
    return this.history.length;
  }

  truncateTo(index: number): void {
    if (index < 0) {
      index = 0;
    }

    if (index > this.history.length) {
      return;
    }

    this.history = this.history.slice(0, index);
  }

  getMessages(): Message[] {
    return [...this.history];
  }

  // Rebuild the history after a compaction: a summary user message followed by
  // the verbatim recent tail (kept messages, structure preserved —
  // tool_use/tool_result blocks intact). Used by doCompact so recent original
  // messages survive instead of being collapsed into the summary. Ordering:
  // summary first, then kept messages. No assistant ack — the kept tail already starts with an
  // assistant message in most cases, and injecting an artificial ack wastes
  // tokens and confuses the model's sense of conversation flow.
  replaceWithCompacted(summaryContent: string, messagesToKeep: Message[]): void {
    this.history = [{ role: "user", content: summaryContent }, ...messagesToKeep];
    this.longTermMemoryInjected = false;
    this.clearUsageAnchor();
  }

  recordUsageAnchor(input: number, output: number, cacheRead: number, cacheCreation: number): void {
    const baseline = input + cacheRead + cacheCreation + output;
    if (baseline <= 0) {
      return;
    }
    this.baselineTokens = baseline;
    this._anchorCount = this.history.length;
  }

  clearUsageAnchor(): void {
    this.baselineTokens = 0;
    this._anchorCount = 0;
  }

  usageAnchorState(): { baselineTokens: number; anchorCount: number } | null {
    if (this.baselineTokens <= 0) {
      return null;
    }
    return { baselineTokens: this.baselineTokens, anchorCount: this._anchorCount };
  }
}
