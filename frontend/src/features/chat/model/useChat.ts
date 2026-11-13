import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chatApi } from "@/shared/api";
import type { ChatMessage, ChatSession } from "@/shared/types/chat";
import { chatKeys, fetchSession, fetchSessions } from "./chatQueries";
import { useActiveSessionStore } from "./activeSession";

/** Список сессий для истории диалогов. */
export function useChatSessions() {
  return useQuery({
    queryKey: chatKeys.sessions,
    queryFn: ({ signal }) => fetchSessions(signal),
  });
}

/** Данные конкретной сессии (сообщения, статусы). */
export function useChatSession(sessionId: string | null) {
  return useQuery({
    queryKey: sessionId ? chatKeys.session(sessionId) : ["chat", "session", "none"],
    queryFn: ({ signal }) => fetchSession(sessionId!, signal),
    enabled: sessionId !== null,
  });
}

/**
 * Гарантирует наличие активной сессии: при первом открытии чата создаёт новую.
 * Защита от двойного создания в React StrictMode: модульный in-flight промис.
 */
let createInFlight: Promise<string> | null = null;

export function useEnsureActiveSession() {
  const activeSessionId = useActiveSessionStore((s) => s.activeSessionId);
  const setActiveSession = useActiveSessionStore((s) => s.setActiveSession);
  const queryClient = useQueryClient();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (activeSessionId !== null || createInFlight) return;
    createInFlight = chatApi.createSession().then((session) => {
      queryClient.setQueryData(chatKeys.session(session.id), session);
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
      return session.id;
    });
    createInFlight
      .then((id) => {
        if (mounted.current) setActiveSession(id);
      })
      .catch(() => {
        // Ошибка создания сессии остаётся в состоянии isCreateError
      })
      .finally(() => {
        createInFlight = null;
      });
  }, [activeSessionId, setActiveSession, queryClient]);

  return { sessionId: activeSessionId };
}

/** Создание нового диалога: новая сессия с пустым контекстом. */
export function useCreateSession() {
  const setActiveSession = useActiveSessionStore((s) => s.setActiveSession);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (initialMessages?: ChatMessage[]) => chatApi.createSession(initialMessages),
    onSuccess: (session) => {
      queryClient.setQueryData(chatKeys.session(session.id), session);
      setActiveSession(session.id);
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
    },
  });
}

/**
 * Закрытие активного диалога: контекст сбрасывается (новый диалог при следующем открытии),
 * но история сессий в хранилище/на сервере не удаляется.
 */
export function useCloseSession() {
  const setActiveSession = useActiveSessionStore((s) => s.setActiveSession);
  const closeSession = useActiveSessionStore((s) => s.closeSession);

  return useCallback(() => {
    closeSession();
    // контекст сброшен — активная сессия больше не отображается
    setActiveSession(null);
  }, [closeSession, setActiveSession]);
}

interface SendContext {
  /** id временного pending-сообщения ассистента, вставленного оптимистично. */
  pendingId: string;
}

export interface SendMessageVars {
  sessionId: string;
  content: string;
  signal?: AbortSignal;
}

/**
 * Отправка сообщения: оптимистично добавляет сообщение пользователя и
 * pending-заглушку ассистента в кэш соответствующей сессии. Ответ записывается
 * в кэш своей сессии, поэтому поздний ответ «старой» сессии не попадёт в новую.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation<SendMessageResponseOf, Error, SendMessageVars, SendContext>({
    mutationFn: ({ sessionId, content, signal }: SendMessageVars) =>
      chatApi.sendMessage({ sessionId, content, signal }),
    onMutate: async ({ sessionId, content }) => {
      await queryClient.cancelQueries({ queryKey: chatKeys.session(sessionId) });
      const previous = queryClient.getQueryData<ChatSession>(chatKeys.session(sessionId));
      const now = new Date().toISOString();
      const userMessage: ChatMessage = {
        id: `user-opt-${now}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        role: "user",
        content,
        createdAt: now,
        status: "complete",
      };
      const pendingId = `assistant-pending-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const pendingMessage: ChatMessage = {
        id: pendingId,
        sessionId,
        role: "assistant",
        content: "",
        createdAt: now,
        status: "pending",
      };
      if (previous) {
        queryClient.setQueryData<ChatSession>(chatKeys.session(sessionId), {
          ...previous,
          messages: [...previous.messages, userMessage, pendingMessage],
          updatedAt: now,
        });
      }
      return { pendingId };
    },
    onError: (_error, { sessionId }, context) => {
      const current = queryClient.getQueryData<ChatSession>(chatKeys.session(sessionId));
      if (!current || !context) return;
      queryClient.setQueryData<ChatSession>(chatKeys.session(sessionId), {
        ...current,
        messages: current.messages
          .filter((m) => m.id !== context.pendingId)
          .map((m) =>
            m.role === "user" && m.status !== "error" && isLastOptimisticUser(m, current.messages)
              ? { ...m, status: "error" }
              : m
          ),
      });
    },
    onSuccess: (response, { sessionId, content }, context) => {
      const current = queryClient.getQueryData<ChatSession>(chatKeys.session(sessionId));
      if (!current || !context) return;
      queryClient.setQueryData<ChatSession>(chatKeys.session(sessionId), {
        ...current,
        // pending заменяется ответом; прежняя копия неудачного сообщения удаляется,
        // чтобы после успешного retry не было дубликата.
        messages: current.messages
          .filter(
            (m) => !(m.role === "user" && m.status === "error" && m.content === content.trim())
          )
          .map((m) => (m.id === context.pendingId ? response.message : m)),
        updatedAt: response.message.createdAt,
      });
    },
    onSettled: (_data, _error, { sessionId }) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
      void queryClient.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
    },
  });
}

export type SendMessageResponseOf = { message: ChatMessage; sessionId: string };

/** Помечает ошибкой только последнее оптимистичное сообщение пользователя. */
function isLastOptimisticUser(message: ChatMessage, messages: ChatMessage[]): boolean {
  const userMessages = messages.filter((m) => m.role === "user");
  return userMessages.length > 0 && userMessages[userMessages.length - 1]!.id === message.id;
}
