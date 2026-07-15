"use client";
import { useCallback } from "react";
import { useChat, type ChatMessage, type NotificationType } from "@/hooks/use-chat";
import Sidebar from "./sidebar";
import ChatContainer from "./chat-container";
import AIOpsBtn from "./ai-ops-btn";
import LoadingOverlay from "./loading-overlay";

const NOTIFY_COLORS: Record<NotificationType, string> = {
  info: "bg-sky-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

export default function ChatApp() {
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
