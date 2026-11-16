/**
 * Локальный реестр сессий, созданных в этом браузере за время жизни страницы.
 *
 * Заменяет вызов GET /admin/dialogs в публичном виджете: этот endpoint отдаёт
 * диалоги ВСЕХ пользователей без авторизации (backend/app/api/admin.py — «пока
 * без авторизации, MVP»), поэтому использовать его в customer-facing frontend
 * небезопасно. Реестр хранит только сессии, созданные здесь, — их transcript
 * подгружается по требованию через публичный GET /chat/{session_id}/messages.
 *
 * In-memory по осознанному решению: после перезагрузки страницы начинается
 * новая сессия (AGENTS.md, п. 6.1), а transcript прежних сессий остаётся в БД
 * backend. Для восстановления списка после перезагрузки нужен user-scoped
 * endpoint с аутентификацией — это зафиксировано как backend-ограничение.
 */

import type { ChatSession } from "@/shared/types/chat";

export interface LocalSessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Первая реплика пользователя — заголовок в списке сессий. */
  title?: string;
}

export interface LocalSessionRegistry {
  register(sessionId: string): void;
  /** Фиксирует реплику пользователя: обновляет title (если пуст) и updatedAt. */
  recordUserMessage(sessionId: string, content: string, at: string): void;
  /** Обновляет updatedAt сессии (например, после ответа ассистента). */
  touch(sessionId: string, at: string): void;
  list(): LocalSessionMeta[];
  has(sessionId: string): boolean;
}

export function createLocalSessionRegistry(): LocalSessionRegistry {
  const sessions = new Map<string, LocalSessionMeta>();

  return {
    register(sessionId) {
      if (sessions.has(sessionId)) return;
      const now = new Date().toISOString();
      sessions.set(sessionId, { id: sessionId, createdAt: now, updatedAt: now });
    },

    recordUserMessage(sessionId, content, at) {
      const meta = sessions.get(sessionId);
      if (!meta) return;
      const trimmed = content.trim();
      if (trimmed && !meta.title) {
        meta.title = trimmed.slice(0, 80);
      }
      meta.updatedAt = at;
    },

    touch(sessionId, at) {
      const meta = sessions.get(sessionId);
      if (meta) meta.updatedAt = at;
    },

    list() {
      return [...sessions.values()].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    },

    has: (sessionId) => sessions.has(sessionId),
  };
}

/** LocalSessionMeta → ChatSession (сообщения подгружаются отдельно через getSession). */
export function toSessionFromMeta(meta: LocalSessionMeta): ChatSession {
  return {
    id: meta.id,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    status: "active",
    messages: [],
    title: meta.title,
  };
}
