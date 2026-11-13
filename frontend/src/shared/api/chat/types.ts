import type { ChatMessage, ChatSession, SendMessageRequest, SendMessageResponse } from "@/shared/types/chat";

export interface SendMessageOptions extends SendMessageRequest {
  signal?: AbortSignal;
}

/**
 * Контракт общения UI с backend/AI-сервисом. Реальная реализация появится
 * после согласования API с backend-командой; пока используется mock.
 */
export interface ChatApi {
  /** "mock" — ответы генерирует локальная заглушка, а не реальный ИИ. */
  readonly mode: "mock" | "live";
  createSession(initialMessages?: ChatMessage[], signal?: AbortSignal): Promise<ChatSession>;
  listSessions(signal?: AbortSignal): Promise<ChatSession[]>;
  getSession(sessionId: string, signal?: AbortSignal): Promise<ChatSession>;
  sendMessage(request: SendMessageOptions): Promise<SendMessageResponse>;
}
