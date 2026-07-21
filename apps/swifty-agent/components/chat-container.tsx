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
import type { ChatMessage, Mode } from "@/hooks/use-chat";
import MessageList from "./msg-list";
import ChatInput from "./chat-input";

interface ChatContainerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
}

export default function ChatContainer({
  messages,
  isStreaming,
  mode,
  onModeChange,
  onSend,
  onUpload,
}: ChatContainerProps) {
  const centered = messages.length === 0;
  return (
    <div
      className={`flex flex-1 flex-col overflow-hidden ${
        centered ? "items-center justify-center" : ""
      }`}
    >
      {centered ? (
        <div className="px-6 text-center text-sky-600">
          <p className="text-2xl">Hello! I am the Swifty Agent OnCall assistant</p>
          <p className="mt-3 text-sm text-zinc-500">
            If this is your first time, upload a file from the docs directory via the
            &quot;...&quot; menu before chatting, otherwise you may get a search error.
          </p>
        </div>
      ) : (
        <MessageList messages={messages} isStreaming={isStreaming} />
      )}
      <div className="w-full px-6 pb-5">
        <ChatInput
          isStreaming={isStreaming}
          mode={mode}
          onModeChange={onModeChange}
          onSend={onSend}
          onUpload={onUpload}
        />
      </div>
    </div>
  );
}
