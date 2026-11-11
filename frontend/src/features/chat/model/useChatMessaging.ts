import { useCallback } from "react";
import type { ChatMessage } from "@/shared/types/chat";
import { useChatSession, useSendMessage } from "./useChat";

export interface ChatMessaging {
  messages: ChatMessage[];
  /** Есть незавершённый запрос ассистента в этой сессии. */
  hasPending: boolean;
  /** Последнее неудачно отправленное сообщение пользователя (для retry). */
  lastFailed: ChatMessage | null;
  /** Быстрые ответы из последнего сообщения ассистента. */
  quickReplies: string[];
  send: (content: string) => void;
  retry: () => void;
  isMutating: boolean;
}

/** Фасад над отправкой/повтором для конкретной сессии. */
export function useChatMessaging(sessionId: string | null): ChatMessaging {
  const { data: session } = useChatSession(sessionId);
  const sendMessage = useSendMessage();

  const messages = session?.messages ?? [];
  const hasPending = messages.some((m) => m.status === "pending");
  const lastFailed =
    [...messages].reverse().find((m) => m.role === "user" && m.status === "error") ?? null;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const quickReplies =
    !hasPending && lastAssistant?.quickReplies && lastAssistant.quickReplies.length > 0
      ? lastAssistant.quickReplies
      : [];

  const send = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      // Блокировка повторной отправки: ассистент ещё отвечает или мутация выполняется
      if (!sessionId || !trimmed || hasPending || sendMessage.isPending) return;
      sendMessage.mutate({ sessionId, content: trimmed });
    },
    [sessionId, hasPending, sendMessage]
  );

  const retry = useCallback(() => {
    if (!sessionId || !lastFailed || sendMessage.isPending) return;
    sendMessage.mutate({ sessionId, content: lastFailed.content });
  }, [sessionId, lastFailed, sendMessage]);

  return {
    messages,
    hasPending,
    lastFailed,
    quickReplies,
    send,
    retry,
    isMutating: sendMessage.isPending,
  };
}
