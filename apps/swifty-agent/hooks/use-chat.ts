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
import { useState, useCallback, useEffect, useMemo } from "react";
import { z } from "zod/v4";
import { chatResponseSchema, aiOpsResponseSchema, uploadResponseSchema } from "@/lib/schemas";

export type Mode = "quick" | "stream";

export interface ChatMessage {
  type: "user" | "assistant";
  content: string;
  /** Optional step details for AI Ops results. */
  detail?: string[];
}

export interface ChatHistory {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AIOpsResult {
  result: string;
  detail: string[];
}

export type NotificationType = "info" | "success" | "warning" | "error";

interface OverlayState {
  show: boolean;
  text: string;
  subtext: string;
}

const MAX_HISTORIES = 50;
const STORAGE_KEY = "swifty-agent-chat-histories";

// Zod schemas for validating the localStorage-persisted chat history shape,
// so JSON.parse results are checked instead of type-asserted.
const chatMessageSchema = z.object({
  type: z.enum(["user", "assistant"]),
  content: z.string(),
  detail: z.array(z.string()).optional(),
});

const chatHistorySchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(chatMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const chatHistoriesSchema = z.array(chatHistorySchema);

// P3-14 fix: use crypto.randomUUID() for cryptographically random session IDs
// (browser-native, available in all modern browsers + Node.js 19+).
function generateSessionId(): string {
  return "session_" + crypto.randomUUID();
}

// Read persisted chat histories from localStorage.
// The `typeof localStorage` guard is a secondary server-safety check — if this
// function is ever called during SSR (it shouldn't be, thanks to the hydration
// guard above), it returns [] instead of throwing a ReferenceError.
function loadHistories(): ChatHistory[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = chatHistoriesSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.type === "user");
  if (!firstUser) return "New chat";
  const c = firstUser.content;
  return c.slice(0, 30) + (c.length > 30 ? "..." : "");
}

export function useChat() {
  const [mode, setMode] = useState<Mode>("quick");
  const [sessionId, setSessionId] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [histories, setHistories] = useState<ChatHistory[]>([]);

  // Initialize client-only state (random session ID, localStorage histories)
  // AFTER hydration completes. useEffect fires after React confirms the
  // server HTML matches the client's first render, so the initial empty
  // values (sessionId="", histories=[]) are consistent on both sides and
  // no hydration mismatch occurs. The subsequent setState triggers a
  // client-only re-render with the real values.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-once init for client-only state after hydration
    setSessionId(generateSessionId());
    setHistories(loadHistories());
  }, []);

  // AbortController state — when set, the effect cleans it up on unmount or
  // when replaced (P1-1 fix).
  const [streamController, setStreamController] = useState<AbortController | null>(null);
  useEffect(() => {
    if (!streamController) return;
    return () => streamController.abort();
  }, [streamController]);

  const [notification, setNotification] = useState<{
    message: string;
    type: NotificationType;
  } | null>(null);
  const [overlay, setOverlay] = useState<OverlayState>({
    show: false,
    text: "",
    subtext: "",
  });

  // P2-9 fix: auto-dismiss notifications after 3s. The timer is created and
  // cleaned up inside the effect (no ref), so unmount naturally clears it.
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 3000);
    return () => clearTimeout(timer);
  }, [notification]);

  const showNotification = useCallback((message: string, type: NotificationType = "info") => {
    setNotification({ message, type });
  }, []);

  // Persist histories to localStorage whenever they change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(histories));
    } catch {
      // ignore quota errors
    }
  }, [histories]);

  // Upsert the current conversation into histories (called after a turn).
  const upsertHistory = useCallback((sid: string, msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    setHistories((prev) => {
      const title = deriveTitle(msgs);
      const now = new Date().toISOString();
      const idx = prev.findIndex((h) => h.id === sid);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          messages: msgs,
          title,
          updatedAt: now,
        };
        return updated;
      }
      return [{ id: sid, title, messages: msgs, createdAt: now, updatedAt: now }, ...prev].slice(
        0,
        MAX_HISTORIES,
      );
    });
  }, []);

  const newChat = useCallback(() => {
    if (isStreaming) {
      showNotification(
        "Please wait for the current chat to finish before starting a new one",
        "warning",
      );
      return;
    }
    setMessages([]);
    setSessionId(generateSessionId());
  }, [isStreaming, showNotification]);

  const loadChatHistory = useCallback(
    (id: string) => {
      const h = histories.find((x) => x.id === id);
      if (!h) return;
      setSessionId(h.id);
      setMessages(h.messages);
    },
    [histories],
  );

  const deleteChatHistory = useCallback(
    (id: string) => {
      setHistories((prev) => prev.filter((h) => h.id !== id));
      if (sessionId === id) {
        setMessages([]);
        setSessionId(generateSessionId());
      }
    },
    [sessionId],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text || isStreaming) return;

      // Track messages in a local variable so we can call upsertHistory in
      // the finally block WITHOUT placing a side effect inside a state
      // updater function (P1-2 fix).
      let currentMsgs: ChatMessage[] = [...messages, { type: "user", content: text }];
      setMessages(currentMsgs);
      setIsStreaming(true);

      // AbortController for cancelling the stream on unmount (P1-1 fix).
      const controller = new AbortController();
      setStreamController(controller);

      try {
        if (mode === "quick") {
          const resp = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sessionId, question: text }),
            signal: controller.signal,
          });
          const parsed = chatResponseSchema.safeParse(await resp.json());
          if (!parsed.success) throw new Error("invalid chat response");
          const answer = parsed.data.data?.answer;
          if (parsed.data.message === "OK" && answer) {
            currentMsgs = [...currentMsgs, { type: "assistant", content: answer }];
            setMessages(currentMsgs);
          } else {
            throw new Error(parsed.data.message || "Unknown error");
          }
        } else {
          const resp = await fetch("/api/chat_stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sessionId, question: text }),
            signal: controller.signal,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const reader = resp.body?.getReader();
          if (!reader) throw new Error("no stream body");
          const decoder = new TextDecoder();
          let buffer = "";
          let full = "";
          let currentEvent = "";
          currentMsgs = [...currentMsgs, { type: "assistant", content: "" }];
          setMessages(currentMsgs);

          while (true) {
            // Check abort before each read so unmount cancels promptly (P1-1 fix).
            if (controller.signal.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const rawLine of lines) {
              // Strip trailing \r for SSE spec compliance (\r\n line endings).
              const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
              if (line.startsWith("id: ")) continue;
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7);
                continue;
              }
              if (line.startsWith("data: ")) {
                const d = line.slice(6);
                if (currentEvent === "message") {
                  full += d === "" ? "\n" : d;
                  currentMsgs = [
                    ...currentMsgs.slice(0, -1),
                    { type: "assistant" as const, content: full },
                  ];
                  setMessages(currentMsgs);
                } else if (currentEvent === "error") {
                  // P1-3 fix: surface server-side error events instead of
                  // silently ignoring them.
                  throw new Error(d || "Stream error");
                }
                // "done" event: clean termination — the reader will return
                // done=true on the next read and the loop will break.
              }
            }
          }
        }
      } catch (e) {
        // AbortError: user navigated away — suppress the error message.
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : String(e);
        currentMsgs = [...currentMsgs, { type: "assistant", content: "Error: " + msg }];
        setMessages(currentMsgs);
      } finally {
        setStreamController(null);
        setIsStreaming(false);
        // P1-2 fix: upsertHistory is called with the local messages array,
        // NOT inside a setMessages state updater.
        if (!controller.signal.aborted && currentMsgs.length > 0) {
          upsertHistory(sessionId, currentMsgs);
        }
      }
    },
    [isStreaming, messages, mode, sessionId, upsertHistory],
  );

  const triggerAIOps = useCallback(async (): Promise<AIOpsResult | null> => {
    setIsStreaming(true);
    setOverlay({
      show: true,
      text: "AI Ops analyzing...",
      subtext: "Backend processing, please wait",
    });
    try {
      const resp = await fetch("/api/ai_ops", { method: "POST" });
      const parsed = aiOpsResponseSchema.safeParse(await resp.json());
      if (!parsed.success) throw new Error("invalid ai ops response");
      const result = parsed.data.data?.result;
      if (parsed.data.message === "OK" && result) {
        return {
          result,
          detail: parsed.data.data?.detail ?? [],
        };
      }
      throw new Error(parsed.data.message || "Unknown error");
    } catch (e) {
      showNotification("AI Ops failed: " + (e instanceof Error ? e.message : String(e)), "error");
      return null;
    } finally {
      setIsStreaming(false);
      setOverlay({ show: false, text: "", subtext: "" });
    }
  }, [showNotification]);

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      const allowed = [".txt", ".md", ".markdown"];
      const name = file.name.toLowerCase();
      if (!allowed.some((ext) => name.endsWith(ext))) {
        showNotification("Only TXT or Markdown (.md) files are supported", "error");
        return null;
      }
      if (file.size > 50 * 1024 * 1024) {
        showNotification("File size must not exceed 50MB", "error");
        return null;
      }
      setIsStreaming(true);
      setOverlay({ show: true, text: "Uploading file...", subtext: file.name });
      try {
        const fd = new FormData();
        fd.append("file", file);
        const resp = await fetch("/api/upload", { method: "POST", body: fd });
        const parsed = uploadResponseSchema.safeParse(await resp.json());
        if (!parsed.success) throw new Error("invalid upload response");
        if (parsed.data.message === "OK" && parsed.data.data !== undefined) {
          return `${file.name} uploaded to knowledge base`;
        }
        throw new Error(parsed.data.message || "Upload failed");
      } catch (e) {
        showNotification("Upload failed: " + (e instanceof Error ? e.message : String(e)), "error");
        return null;
      } finally {
        setIsStreaming(false);
        setOverlay({ show: false, text: "", subtext: "" });
      }
    },
    [showNotification],
  );

  // P1-6 fix: stabilize addMessage with useCallback so its reference is stable.
  const addMessage = useCallback((msg: ChatMessage) => setMessages((prev) => [...prev, msg]), []);

  // P1-6 fix: wrap the return object in useMemo so callers that depend on
  // individual fields (via destructuring) get stable references and their
  // useCallback dependencies don't invalidate on every render.
  return useMemo(
    () => ({
      mode,
      setMode,
      sessionId,
      isStreaming,
      messages,
      addMessage,
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
    }),
    [
      mode,
      sessionId,
      isStreaming,
      messages,
      addMessage,
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
    ],
  );
}
