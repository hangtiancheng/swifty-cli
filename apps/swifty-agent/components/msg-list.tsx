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

"use client";
import { memo, useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/use-chat";
import MdRender from "./md-render";
import { Sparkles } from "lucide-react";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

export default function MessageList({ messages, isStreaming }: MessageListProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-6 py-4">
      {messages.map((m, i) => (
        <MessageItem
          key={i}
          message={m}
          streaming={isStreaming && i === messages.length - 1 && m.type === "assistant"}
        />
      ))}
    </div>
  );
}

// P1-6 fix: wrap MessageItem in memo so streaming chunks (which only change
// the last message) don't re-render every message in the list.
const MessageItem = memo(function MessageItem({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
}) {
  if (message.type === "user") {
    return (
      <div className="mb-6 flex flex-col items-end">
        <div className="max-w-[70%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-100 px-4 py-3 text-sm text-zinc-800">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-green-500">
        <Sparkles className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        {message.detail && message.detail.length > 0 && (
          <details className="mb-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-sky-600">
              View details ({message.detail.length} steps)
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {message.detail.map((d, idx) => (
                <div
                  key={idx}
                  className="border-l-2 border-sky-400 bg-white p-2 text-xs text-zinc-700"
                >
                  <strong className="text-sky-600">Step {idx + 1}:</strong>
                  <MdRender
                    content={d}
                    className="max-w-none wrap-break-word text-xs leading-relaxed text-zinc-700"
                  />
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="text-sm text-zinc-800">
          <MdRender content={message.content} />
          {streaming && <span className="ml-1 animate-pulse text-sky-500">|</span>}
        </div>
      </div>
    </div>
  );
});
