// Corresponds to the source project's internal/ai/models/open_ai.go
// Supports both OpenAI-compatible providers (DeepSeek, etc.) and Anthropic.
// Select provider via LLM_PROVIDER env var: "openai" (default) | "anthropic".
// 'think' is used for planner/replanner, 'quick' is used for executor/chat.
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { config } from "@/lib/config";
import type { LanguageModel } from "ai";

function resolveThinkModel(): LanguageModel {
  // Anthropic
  if (config.provider === "anthropic") {
    const provider = createAnthropic({
      baseURL: config.anthropic.think.baseURL,
      apiKey: config.anthropic.think.apiKey,
    });
    return provider(config.anthropic.think.model);
  }
  // OpenAI
  const provider = createOpenAI({
    baseURL: config.deepseek.think.baseURL,
    apiKey: config.deepseek.think.apiKey,
  });
  return provider.chat(config.deepseek.think.model);
}

function resolveQuickModel(): LanguageModel {
  // Anthropic
  if (config.provider === "anthropic") {
    const provider = createAnthropic({
      baseURL: config.anthropic.quick.baseURL,
      apiKey: config.anthropic.quick.apiKey,
    });
    return provider(config.anthropic.quick.model);
  }
  // OpenAI
  const provider = createOpenAI({
    baseURL: config.deepseek.quick.baseURL,
    apiKey: config.deepseek.quick.apiKey,
  });
  return provider.chat(config.deepseek.quick.model);
}

// ToolCallingChatModel (LanguageModelV4), used for streamText/generateText/generateObject
export const thinkModel = resolveThinkModel();
export const quickModel = resolveQuickModel();

// Anthropic provider options for extended thinking (mirrors swifty/src/llm/anthropic.ts L310-322)
export const providerOptions =
  config.provider === "anthropic"
    ? {
        anthropic: {
          thinking: config.anthropic.thinking
            ? ({
                type: "enabled",
                budgetTokens: config.anthropic.maxOutputTokens - 1,
              } as const)
            : ({ type: "disabled" } as const),
        },
      }
    : undefined;
