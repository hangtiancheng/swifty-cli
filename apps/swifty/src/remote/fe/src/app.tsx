import { useCallback } from "react";
import { InputArea } from "./components/input-area";
import { MessageList } from "./components/message-list";
import { StatusBar } from "./components/status-bar";
import { useChat } from "./hooks/use-chat";
import { useWebSocket } from "./hooks/use-web-socket";
import type { ClientMessage, PermissionResponse } from "./types";

export function App() {
  const { state, dispatchMessage, setConnection, respondPermission, markAskAnswered } = useChat();

  const { send } = useWebSocket({
    onMessage: dispatchMessage,
    onOpen: () => setConnection("connected"),
    onClose: () => setConnection("reconnecting"),
  });

  const handleSend = useCallback(
    (text: string) => {
      const msg: ClientMessage = {
        type: "user_message",
        data: { content: text },
      };
      send(msg);
    },
    [send],
  );

  const handleRespondPermission = useCallback(
    (id: string, response: PermissionResponse) => {
      respondPermission(id, response);
      const msg: ClientMessage = {
        type: "permission_response",
        data: { id, response },
      };
      send(msg);
    },
    [respondPermission, send],
  );

  const handleAnswerAsk = useCallback(
    (id: string, answers: Record<string, string>) => {
      markAskAnswered(id);
      const msg: ClientMessage = {
        type: "ask_user_response",
        data: { id, answers },
      };
      send(msg);
    },
    [markAskAnswered, send],
  );

  return (
    <div className="mx-auto flex h-screen max-w-[960px] flex-col bg-bg font-mono text-sm text-base">
      <StatusBar connection={state.connection} usage={state.usage} />
      <MessageList
        items={state.items}
        onRespondPermission={handleRespondPermission}
        onAnswerAsk={handleAnswerAsk}
      />
      <InputArea streaming={state.streaming} commands={state.commands} onSend={handleSend} />
    </div>
  );
}
