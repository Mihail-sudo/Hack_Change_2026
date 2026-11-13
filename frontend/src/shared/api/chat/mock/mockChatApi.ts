import { ApiClientError } from "@/shared/api/apiClient";
import type { ChatMessage, ChatSession, SendMessageResponse } from "@/shared/types/chat";
import type { ChatApi, SendMessageOptions } from "../types";
import { consumeMockFailure } from "./mockFailure";
import { createGreetingMessage, nextAssistantStep } from "./mockScript";
import { MockChatStore } from "./mockStore";

export interface MockChatApiOptions {
  /** Диапазон имитации задержки «генерации» ответа, мс. */
  minDelayMs?: number;
  maxDelayMs?: number;
  store?: MockChatStore;
}

const DEFAULT_MIN_DELAY = 400;
const DEFAULT_MAX_DELAY = 900;

function abortAwareDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Запрос отменён", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Запрос отменён", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Mock-реализация ChatApi: локальный сценарий с задержками, симуляцией ошибок
 * и поддержкой AbortSignal. Не является реальным ИИ и не использует базу знаний.
 */
export function createMockChatApi(options: MockChatApiOptions = {}): ChatApi {
  const minDelay = options.minDelayMs ?? DEFAULT_MIN_DELAY;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY;
  const store = options.store ?? new MockChatStore();

  const randomDelay = () => Math.round(minDelay + Math.random() * (maxDelay - minDelay));

  return {
    mode: "mock",

    async createSession(messages: ChatMessage[] = [], signal?: AbortSignal): Promise<ChatSession> {
      await abortAwareDelay(randomDelay(), signal);
      const failure = consumeMockFailure();
      if (failure) throw failure;

      const now = new Date().toISOString();
      let session: ChatSession;
      if (messages.length > 0) {
        session = store.createSession([...messages]);
      } else {
        // Пустая сессия нового диалога начинается с приветствия ассистента.
        const created = store.createSession([]);
        const greeting = createGreetingMessage(
          created.id,
          `greeting-${now}-${Math.random().toString(36).slice(2, 8)}`,
          now
        );
        store.appendMessages(created.id, [greeting]);
        session = store.get(created.id)!;
      }
      const lastMessage = session.messages[session.messages.length - 1];
      return {
        ...session,
        updatedAt: lastMessage ? lastMessage.createdAt : now,
      };
    },

    async listSessions(signal?: AbortSignal): Promise<ChatSession[]> {
      await abortAwareDelay(120, signal);
      return store.list();
    },

    async getSession(sessionId: string, signal?: AbortSignal): Promise<ChatSession> {
      await abortAwareDelay(120, signal);
      const session = store.get(sessionId);
      if (!session) {
        throw new ApiClientError("NOT_FOUND", `Сессия ${sessionId} не найдена`, 404);
      }
      return session;
    },

    async sendMessage(request: SendMessageOptions): Promise<SendMessageResponse> {
      const { sessionId, content, signal } = request;
      await abortAwareDelay(randomDelay(), signal);
      const failure = consumeMockFailure();
      if (failure) throw failure;

      const trimmed = content.trim();
      if (!trimmed) {
        throw new ApiClientError("VALIDATION_ERROR", "Сообщение не может быть пустым");
      }

      const session = store.get(sessionId);
      if (!session) {
        throw new ApiClientError("NOT_FOUND", `Сессия ${sessionId} не найдена`, 404);
      }

      const now = new Date().toISOString();
      const delay = randomDelay();
      const userMessage: ChatMessage = {
        id: `user-${now}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        role: "user",
        content: trimmed,
        createdAt: now,
        status: "complete",
      };
      // Сначала добавляем сообщение пользователя, затем вычисляем
      // следующий шаг сценария по обновлённой истории
      store.appendMessages(sessionId, [userMessage]);
      const updatedSession = store.get(sessionId)!;
      const step = nextAssistantStep(updatedSession.messages);
      const assistantMessage: ChatMessage = {
        id: `assistant-${now}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        role: "assistant",
        content: step.content,
        createdAt: now,
        status: "complete",
        responseTimeMs: delay,
        ...(step.quickReplies ? { quickReplies: step.quickReplies } : {}),
      };
      store.appendMessages(sessionId, [assistantMessage]);

      return { message: assistantMessage, sessionId };
    },
  };
}
