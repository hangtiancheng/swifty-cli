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

import { useCallback } from "react";
import { useChat, type ChatMessage, type NotificationType } from "@/hooks/use-chat";
import Sidebar from "@/components/sidebar";
import ChatContainer from "@/components/chat-container";
import AIOpsBtn from "@/components/ai-ops-btn";
import LoadingOverlay from "@/components/loading-overlay";

const NOTIFY_COLORS: Record<NotificationType, string> = {
  info: "bg-sky-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

export default function Home() {
  // P1-6 fix: destructure individual fields so useCallback dependencies can
  // be granular — handleAIOps only rebuilds when isStreaming changes, not
  // when messages or other unrelated state changes.
  const {
    isStreaming,
    messages,
    sessionId,
    mode,
    setMode,
    histories,
    notification,
    overlay,
    showNotification,
    newChat,
    loadChatHistory,
    deleteChatHistory,
    sendMessage,
    triggerAIOps,
    uploadFile,
    addMessage,
  } = useChat();

  const handleAIOps = useCallback(async () => {
    if (isStreaming) {
      showNotification("Please wait for the current operation to finish", "warning");
      return;
    }
    newChat();
    const r = await triggerAIOps();
    if (r) {
      const msg: ChatMessage = {
        type: "assistant",
        content: r.result,
        detail: r.detail,
      };
      addMessage(msg);
    }
  }, [isStreaming, showNotification, newChat, triggerAIOps, addMessage]);

  const handleUpload = useCallback(
    async (file: File) => {
      const msg = await uploadFile(file);
      if (msg) addMessage({ type: "assistant", content: msg });
    },
    [uploadFile, addMessage],
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-900">
      <Sidebar
        histories={histories}
        activeId={sessionId}
        onNewChat={newChat}
        onLoad={loadChatHistory}
        onDelete={deleteChatHistory}
      />
      <main className="relative flex flex-1 flex-col overflow-hidden bg-white">
        <AIOpsBtn onClick={handleAIOps} disabled={isStreaming} />
        <ChatContainer
          messages={messages}
          isStreaming={isStreaming}
          mode={mode}
          onModeChange={setMode}
          onSend={sendMessage}
          onUpload={handleUpload}
        />
      </main>
      <LoadingOverlay overlay={overlay} />
      {notification && (
        <div
          className={`fixed right-5 top-5 z-10000 max-w-xs rounded-lg p-4 text-sm font-medium text-white shadow-lg ${
            NOTIFY_COLORS[notification.type]
          }`}
        >
          {notification.message}
        </div>
      )}
    </div>
  );
}
