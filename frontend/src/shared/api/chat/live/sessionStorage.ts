/**
 * Персистентное хранение метаданных сессий в localStorage.
 *
 * Хранится только metadata (id, title, createdAt, updatedAt, persistedOnBackend).
 * Транскрипты сообщений остаются на backend — source of truth.
 *
 * Используется версионированный ключ, чтобы безопасно менять формат данных.
 */

const STORAGE_KEY = "energytool.sessions.v1";

export interface StoredSessionMeta {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  /** Была ли сессия хотя бы раз отправлена на backend (первое сообщение). */
  persistedOnBackend: boolean;
}

export interface StoredRegistry {
  version: 1;
  activeSessionId: string | null;
  sessions: StoredSessionMeta[];
}

/**
 * Загружает реестр сессий из localStorage.
 * При ошибке парсинга возвращает пустой реестр (graceful degradation).
 */
export function loadSessionRegistry(): StoredRegistry {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { version: 1, activeSessionId: null, sessions: [] };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      (parsed as StoredRegistry).version === 1
    ) {
      const registry = parsed as StoredRegistry;
      // Validate sessions array
      if (!Array.isArray(registry.sessions)) {
        return { version: 1, activeSessionId: null, sessions: [] };
      }
      return registry;
    }
    // Unknown version or format — reset
    return { version: 1, activeSessionId: null, sessions: [] };
  } catch {
    // Malformed JSON or unavailable localStorage — graceful recovery
    return { version: 1, activeSessionId: null, sessions: [] };
  }
}

/**
 * Сохраняет реестр сессий в localStorage.
 * При недоступности localStorage — молча игнорирует (приложение работает в памяти).
 */
export function saveSessionRegistry(registry: StoredRegistry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // localStorage unavailable or quota exceeded — keep working in memory
  }
}

/**
 * Создаёт обновлённый реестр с новой сессией.
 * Не делает HTTP-запросов — только локальная запись.
 */
export function addSessionToRegistry(
  registry: StoredRegistry,
  sessionId: string
): StoredRegistry {
  const now = new Date().toISOString();
  const newSession: StoredSessionMeta = {
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    persistedOnBackend: false,
  };
  return {
    ...registry,
    activeSessionId: sessionId,
    sessions: [newSession, ...registry.sessions],
  };
}

/**
 * Обновляет метаданные сессии после отправки первого сообщения.
 */
export function updateSessionOnFirstMessage(
  registry: StoredRegistry,
  sessionId: string,
  content: string,
  at: string
): StoredRegistry {
  return {
    ...registry,
    sessions: registry.sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const trimmed = content.trim();
      return {
        ...s,
        title: s.title || (trimmed ? trimmed.slice(0, 80) : undefined),
        updatedAt: at,
        persistedOnBackend: true,
      };
    }),
  };
}

/**
 * Просто touch updatedAt сессии (после ответа ассистента или нового сообщения).
 */
export function touchSession(
  registry: StoredRegistry,
  sessionId: string,
  at: string
): StoredRegistry {
  return {
    ...registry,
    sessions: registry.sessions.map((s) =>
      s.id === sessionId ? { ...s, updatedAt: at } : s
    ),
  };
}

/**
 * Устанавливает активную сессию.
 */
export function setActiveSessionInRegistry(
  registry: StoredRegistry,
  sessionId: string | null
): StoredRegistry {
  return {
    ...registry,
    activeSessionId: sessionId,
  };
}

/** Доступен ли localStorage в текущем окружении. */
export function isStorageAvailable(): boolean {
  try {
    const test = "__storage_test__";
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}
