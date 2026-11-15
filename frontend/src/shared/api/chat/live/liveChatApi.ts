import { apiClient } from "@/shared/api/apiClient";
import type { ChatMessage, ChatSession, SendMessageResponse } from "@/shared/types/chat";
import type { ChatApi, SendMessageOptions } from "../types";
import type {
  ChatRequestDto,
  ChatResponseDto,
  DialogListResponseDto,
  MessagesReadDto,
} from "./dto";
import {
  toAssistantMessage,
  toSessionFromDialog,
  toSessionFromMessages,
} from "./mapping";

/**
 * Live-реализация ChatApi на реальном backend (см. аудит: openapi.json).
 *
 * Особенности backend, отражённые здесь:
 * - Нет эндпоинта «создать сессию»: диалог создаётся первым POST /chat.
 *   ID генерируется локально (crypto.randomUUID подходит под шаблон
 *   ^[A-Za-z0-9_-]{8,128}$); приветствие НЕ выдумывается — пустой диалог
 *   показывается как пустой.
 * - Список сессий берётся из GET /admin/dialogs — других источников нет.
 * - История сессии — GET /chat/{session_id}/messages (транскрипт в SQLite).
 * - POST /chat возвращает {reply, done, fallback, mode}; message собирается
 *   на frontend, responseTimeMs измеряется на frontend.
 * - mode="admin": reply пустой — сообщение доставлено оператору, ответ придёт
 *   через поллинг сообщений. Пустой ассистент-ответ отбрасывается в useChat.
 * - Никаких скрытых fallback на mock: ошибка API пробрасывается вызывающему коду.
 */

const CHAT_TIMEOUT_MS = 60_000; // реальный LLM-агент может отвечать дольше дефолтных 30 с
const LIST_TIMEOUT_MS = 15_000;

export function createLiveChatApi(): ChatApi {
  return {
    mode: "live",

    async createSession(
      _initialMessages?: ChatMessage[],
      _signal?: AbortSignal
    ): Promise<ChatSession> {
      // Backend создаёт диалог только при первом POST /chat — HTTP-запрос не нужен.
      const now = new Date().toISOString();
      return {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        status: "active",
        messages: [],
      };
    },

    async listSessions(signal?: AbortSignal): Promise<ChatSession[]> {
      const dto = await apiClient<DialogListResponseDto>("/admin/dialogs", {
        signal,
        timeoutMs: LIST_TIMEOUT_MS,
      });
      return dto.dialogs.map(toSessionFromDialog);
    },

    async getSession(sessionId: string, signal?: AbortSignal): Promise<ChatSession> {
      const dto = await apiClient<MessagesReadDto>(
        `/chat/${encodeURIComponent(sessionId)}/messages`,
        { signal, timeoutMs: LIST_TIMEOUT_MS }
      );
      return toSessionFromMessages(dto);
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

      return {
        message: toAssistantMessage(dto.reply, sessionId, responseTimeMs),
        sessionId,
      };
    },
  } satisfies ChatApi;
}
