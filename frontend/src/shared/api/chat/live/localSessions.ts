/**
 * Локальный реестр сессий, созданных в этом браузере за время жизни страницы.
 *
 * Заменяет вызов GET /admin/dialogs в публичном виджете: этот endpoint отдаёт
 * диалоги ВСЕХ пользователей без авторизации (backend/app/api/admin.py — «пока
 * без авторизации, MVP»), поэтому использовать его в customer-facing frontend
 * небезопасно. Реестр хранит только сессии, созданные здесь, — их transcript
 * подгружается по требованию через публичный GET /chat/{session_id}/messages.
 *
 * По умолчанию — in-memory. Для персистентности между перезагрузками используй
 * createPersistentRegistry() поверх этого реестра.
 */

import type { ChatSession } from "@/shared/types/chat";
import {
  loadSessionRegistry,
  saveSessionRegistry,
  addSessionToRegistry,
  updateSessionOnFirstMessage,
  touchSession,
  type StoredRegistry,
} from "./sessionStorage";

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

/**
 * Оборачивает существующий LocalSessionRegistry слоем персистентности в localStorage.
 *
 * При инициализации загружает сохранённые сессии из localStorage и восстанавливает
 * их в памяти. Все последующие изменения синхронизируются в localStorage.
 *
 * @param inner - базовый in-memory реестр (обычно createLocalSessionRegistry())
 */
export function createPersistentRegistry(
  inner: LocalSessionRegistry
): LocalSessionRegistry & { getStoredRegistry: () => StoredRegistry } {
  // Загружаем сохранённые сессии из localStorage
  let storedRegistry = loadSessionRegistry();

  // Восстанавливаем in-memory состояние из localStorage
  for (const stored of storedRegistry.sessions) {
    if (!inner.has(stored.id)) {
      inner.register(stored.id);
      // Восстанавливаем title, если он был сохранён
      if (stored.title) {
        inner.recordUserMessage(stored.id, stored.title, stored.updatedAt);
      }
    }
  }

  return {
    register(sessionId) {
      const existed = inner.has(sessionId);
      inner.register(sessionId);
      if (!existed) {
        storedRegistry = addSessionToRegistry(storedRegistry, sessionId);
        saveSessionRegistry(storedRegistry);
      }
    },

    recordUserMessage(sessionId, content, at) {
      inner.recordUserMessage(sessionId, content, at);
      // Фиксируем первое сообщение и обновляем title
      const session = storedRegistry.sessions.find((s) => s.id === sessionId);
      if (session && !session.persistedOnBackend) {
        storedRegistry = updateSessionOnFirstMessage(
          storedRegistry,
          sessionId,
          content,
          at
        );
        saveSessionRegistry(storedRegistry);
      }
    },

    touch(sessionId, at) {
      inner.touch(sessionId, at);
      storedRegistry = touchSession(storedRegistry, sessionId, at);
      saveSessionRegistry(storedRegistry);
    },

    list() {
      return inner.list();
    },

    has: (sessionId) => inner.has(sessionId),

    /** Доступ к сырому хранилищу (для отладки). */
    getStoredRegistry: () => storedRegistry,
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
