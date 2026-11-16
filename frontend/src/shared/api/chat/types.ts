import type {
  ChatMessage,
  ChatSession,
  DialogMode,
  SendMessageRequest,
  SendMessageResponse,
} from "@/shared/types/chat";

export interface SendMessageOptions extends SendMessageRequest {
  signal?: AbortSignal;
}

/** Результат опроса новых сообщений (GET /chat/{session_id}/messages?after_id=N). */
export interface NewMessagesResult {
  /** Текущий режим диалога на backend. */
  mode: DialogMode;
  /** Новые сообщения (включая реплики пользователя — фильтрацией занимается UI-слой). */
  messages: ChatMessage[];
  /** Максимальный числовой id сервера среди полученных сообщений (новый курсор after_id). */
  lastId: number;
}

/**
 * Контракт общения UI с backend/AI-сервисом.
 *
 * Live-реализация (live/) отражает реальный контракт backend:
 * - POST /chat — отправка сообщения;
 * - GET /chat/{session_id}/messages?after_id=N — история и поллинг новых сообщений;
 * - POST /chat/handoff — запрос оператора;
 * - сессии, созданные в этом браузере, — локальный реестр (listSessions):
 *   небезопасно вызывать GET /admin/dialogs из публичного виджета (см. liveChatApi).
 *
 * Mock-реализация (mock/) имитирует контракт для демо и тестов.
 */
export interface ChatApi {
  /** "mock" — ответы генерирует локальная заглушка, а не реальный ИИ. */
  readonly mode: "mock" | "live";
  createSession(initialMessages?: ChatMessage[], signal?: AbortSignal): Promise<ChatSession>;
  listSessions(signal?: AbortSignal): Promise<ChatSession[]>;
  getSession(sessionId: string, signal?: AbortSignal): Promise<ChatSession>;
  sendMessage(request: SendMessageOptions): Promise<SendMessageResponse>;
  /**
   * Новые сообщения сессии после after_id (курсор — числовой id из БД backend).
   * Используется для поллинга реплик оператора; режим диалога возвращается в mode.
   */
  listNewMessages(
    sessionId: string,
    afterId: number,
    signal?: AbortSignal
  ): Promise<NewMessagesResult>;
  /** Запрос живого оператора (POST /chat/handoff). */
  requestHandoff(sessionId: string, signal?: AbortSignal): Promise<void>;
}
