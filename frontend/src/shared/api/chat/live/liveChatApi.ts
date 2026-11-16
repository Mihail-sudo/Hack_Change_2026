import { apiClient } from "@/shared/api/apiClient";
import type { ChatMessage, ChatSession, SendMessageResponse } from "@/shared/types/chat";
import type { ChatApi, NewMessagesResult, SendMessageOptions } from "../types";
import type {
  ChatRequestDto,
  ChatResponseDto,
  HandoffRequestDto,
  HandoffResponseDto,
  MessagesReadDto,
} from "./dto";
import { toAssistantMessage, toSessionFromMessages, toDomainMessage } from "./mapping";
import {
  createLocalSessionRegistry,
  createPersistentRegistry,
  toSessionFromMeta,
  type LocalSessionRegistry,
} from "./localSessions";

/**
 * Live-реализация ChatApi на реальном backend (контракт из openapi.json).
 *
 * Особенности backend, отражённые здесь:
 * - Нет эндпоинта «создать сессию»: диалог создаётся первым POST /chat.
 *   ID генерируется локально (crypto.randomUUID подходит под шаблон
 *   ^[A-Za-z0-9_-]{8,128}$); приветствие НЕ выдумывается — пустой диалог
 *   показывается как пустой.
 * - Список сессий — ЛОКАЛЬНЫЙ реестр сессий этого браузера. Endpoint
 *   GET /admin/dialogs существует, но без авторизации возвращает диалоги всех
 *   пользователей — вызывать его из публичного виджета небезопасно (аудит,
 *   backend/app/api/admin.py). Нужен user-scoped endpoint — см. отчёт.
 * - История сессии — GET /chat/{session_id}/messages (транскрипт в SQLite).
 * - Поллинг новых сообщений (реплики оператора) — тот же endpoint с курсором
 *   after_id; MessageRead.author различает client/bot/admin.
 * - POST /chat возвращает {reply, done, fallback, mode}; responseTimeMs
 *   измеряется на frontend.
 * - POST /chat/handoff — запрос живого оператора.
 * - mode="admin": reply пустой — сообщение доставлено оператору, ответ придёт
 *   через поллинг сообщений. Пустой ассистент-ответ отбрасывается в useChat.
 * - Никаких скрытых fallback на mock: ошибка API пробрасывается вызывающему коду.
 */

const CHAT_TIMEOUT_MS = 60_000; // реальный LLM-агент может отвечать дольше дефолтных 30 с
const LIST_TIMEOUT_MS = 15_000;

export function createLiveChatApi(
  registry: LocalSessionRegistry = createPersistentRegistry(createLocalSessionRegistry())
) {
  return {
    mode: "live" as const,

    async createSession(
      _initialMessages?: ChatMessage[],
      _signal?: AbortSignal
    ): Promise<ChatSession> {
      // Backend создаёт диалог только при первом POST /chat — HTTP-запрос не нужен.
      const now = new Date().toISOString();
      const session: ChatSession = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        status: "active",
        messages: [],
      };
      registry.register(session.id);
      return session;
    },

    async listSessions(_signal?: AbortSignal): Promise<ChatSession[]> {
      // Только сессии, созданные в этом браузере (см. комментарий выше про /admin/dialogs).
      return registry.list().map(toSessionFromMeta);
    },

    async getSession(sessionId: string, signal?: AbortSignal): Promise<ChatSession> {
      const dto = await apiClient<MessagesReadDto>(
        `/chat/${encodeURIComponent(sessionId)}/messages`,
        { signal, timeoutMs: LIST_TIMEOUT_MS }
      );
      const session = toSessionFromMessages(dto);
      // Синхронизируем метаданные локального реестра с сервером.
      if (registry.has(sessionId)) {
        for (const message of session.messages) {
          if (message.role === "user" && message.author === "client") {
            registry.recordUserMessage(sessionId, message.content, message.createdAt);
          }
        }
      }
      return session;
    },

    async sendMessage({
      sessionId,
      content,
      signal,
    }: SendMessageOptions): Promise<SendMessageResponse> {
      const startedAt = performance.now();
      const dto = await apiClient<ChatResponseDto>("/chat", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, message: content } satisfies ChatRequestDto),
        signal,
        timeoutMs: CHAT_TIMEOUT_MS,
      });
      const responseTimeMs = Math.round(performance.now() - startedAt);

      // Реплика пользователя сохранена на сервере — фиксируем в локальном реестре.
      registry.recordUserMessage(sessionId, content, new Date().toISOString());

      return {
        message: toAssistantMessage(dto.reply, sessionId, responseTimeMs, dto.fallback),
        sessionId,
      };
    },

    async listNewMessages(
      sessionId: string,
      afterId: number,
      signal?: AbortSignal
    ): Promise<NewMessagesResult> {
      const dto = await apiClient<MessagesReadDto>(
        `/chat/${encodeURIComponent(sessionId)}/messages?after_id=${afterId}`,
        { signal, timeoutMs: LIST_TIMEOUT_MS }
      );
      const messages = dto.messages.map((m) => toDomainMessage(m, sessionId));
      const lastId =
        dto.messages.length > 0 ? Math.max(...dto.messages.map((m) => m.id)) : afterId;
      return { mode: dto.mode, messages, lastId };
    },

    async requestHandoff(sessionId: string, signal?: AbortSignal): Promise<void> {
      const body: HandoffRequestDto = { session_id: sessionId };
      await apiClient<HandoffResponseDto>("/chat/handoff", {
        method: "POST",
        body: JSON.stringify(body),
        signal,
      });
    },
  } satisfies ChatApi;
}
