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
import { A2uiView } from "@swifty.js/a2ui-shadcn";
import MdRender from "./md-render";
import { LoaderCircle, Sparkles } from "lucide-react";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  /** Receives serialized A2UI surface actions to auto-send as chat messages. */
  onAction: (query: string) => void;
}

export default function MessageList({
  messages,
  isStreaming,
  onAction,
}: MessageListProps) {
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
          streaming={
            isStreaming && i === messages.length - 1 && m.type === "assistant"
          }
          onAction={onAction}
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
  onAction,
}: {
  message: ChatMessage;
  streaming: boolean;
  onAction: (query: string) => void;
}) {
  if (message.type === "user") {
    return (
      <div className="mb-6 flex flex-col items-end">
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-zinc-100 px-4 py-3 text-sm whitespace-pre-wrap text-zinc-800">
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
                    className="max-w-none text-xs leading-relaxed wrap-break-word text-zinc-700"
                  />
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="text-sm text-zinc-800">
          {message.pending ? (
            <div className="flex items-center gap-2 py-1 text-zinc-400">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>Thinking...</span>
            </div>
          ) : (
            <MdRender content={message.content} streaming={streaming} />
          )}
          {message.a2ui && message.a2ui.length > 0 && (
            <A2uiView messages={message.a2ui} onAction={onAction} />
          )}
        </div>
      </div>
    </div>
  );
});
