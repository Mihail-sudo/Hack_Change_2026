/**
 * Тесты персистентности реестра сессий (localStorage).
 *
 * Проверяемые сценарии:
 * 1. Реестр восстанавливается из localStorage.
 * 2. Новые сессии сохраняются в localStorage.
 * 3. title и updatedAt персистентны.
 * 4. Пустые сессии переживают перезагрузку (mock реестра с тем же хранилищем).
 * 5. Malformed данные обрабатываются без падения.
 * 6. Недоступный localStorage не роняет приложение.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadSessionRegistry,
  saveSessionRegistry,
  addSessionToRegistry,
  updateSessionOnFirstMessage,
  touchSession,
  setActiveSessionInRegistry,
  isStorageAvailable,
  type StoredRegistry,
} from "./sessionStorage";
import {
  createLocalSessionRegistry,
  createPersistentRegistry,
} from "./localSessions";

const STORAGE_KEY = "energytool.sessions.v1";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("sessionStorage: загрузка и сохранение", () => {
  it("пустое хранилище → пустой реестр", () => {
    const registry = loadSessionRegistry();
    expect(registry.sessions).toEqual([]);
    expect(registry.activeSessionId).toBeNull();
    expect(registry.version).toBe(1);
  });

  it("сохранённый реестр восстанавливается из localStorage", () => {
    const stored = {
      version: 1,
      activeSessionId: "s-1",
      sessions: [
        {
          id: "s-1",
          title: "Счета выросли",
          createdAt: "2026-11-15T10:00:00Z",
          updatedAt: "2026-11-15T10:05:00Z",
          persistedOnBackend: true,
        },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const registry = loadSessionRegistry();
    expect(registry.activeSessionId).toBe("s-1");
    expect(registry.sessions).toHaveLength(1);
    expect(registry.sessions[0]).toMatchObject({
      id: "s-1",
      title: "Счета выросли",
      persistedOnBackend: true,
    });
  });

  it("malformed JSON → пустой реестр без падения", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => loadSessionRegistry()).not.toThrow();
    expect(loadSessionRegistry().sessions).toEqual([]);
  });

  it("неизвестная версия → пустой реестр (сброс формата)", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 99, activeSessionId: "x", sessions: [] })
    );
    const registry = loadSessionRegistry();
    expect(registry.sessions).toEqual([]);
  });

  it("sessions не массив → пустой реестр", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, activeSessionId: null, sessions: "oops" })
    );
    expect(loadSessionRegistry().sessions).toEqual([]);
  });

  it("недоступный localStorage не роняет приложение", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(loadSessionRegistry().sessions).toEqual([]);
    expect(() =>
      saveSessionRegistry({ version: 1, activeSessionId: null, sessions: [] })
    ).not.toThrow();
    expect(isStorageAvailable()).toBe(false);
  });
});

describe("sessionStorage: операции реестра", () => {
  function emptyRegistry(): StoredRegistry {
    return { version: 1, activeSessionId: null, sessions: [] };
  }

  it("addSessionToRegistry добавляет сессию и делает её активной", () => {
    let registry = emptyRegistry();
    registry = addSessionToRegistry(registry, "s-new");

    expect(registry.activeSessionId).toBe("s-new");
    expect(registry.sessions).toHaveLength(1);
    expect(registry.sessions[0]!.persistedOnBackend).toBe(false);
  });

  it("updateSessionOnFirstMessage ставит title и помечает persistedOnBackend", () => {
    let registry = emptyRegistry();
    registry = addSessionToRegistry(registry, "s-1");
    registry = updateSessionOnFirstMessage(registry, "s-1", "Счета выросли", "2026-11-16T12:00:00Z");

    expect(registry.sessions[0]).toMatchObject({
      title: "Счета выросли",
      updatedAt: "2026-11-16T12:00:00Z",
      persistedOnBackend: true,
    });
  });

  it("touchSession обновляет только updatedAt", () => {
    let registry = emptyRegistry();
    registry = addSessionToRegistry(registry, "s-1");
    registry = updateSessionOnFirstMessage(registry, "s-1", "Вопрос", "2026-11-16T12:00:00Z");
    registry = touchSession(registry, "s-1", "2026-11-16T12:30:00Z");

    expect(registry.sessions[0]!.updatedAt).toBe("2026-11-16T12:30:00Z");
    expect(registry.sessions[0]!.title).toBe("Вопрос");
  });

  it("setActiveSessionInRegistry обновляет активную сессию", () => {
    let registry = emptyRegistry();
    registry = addSessionToRegistry(registry, "s-1");
    registry = addSessionToRegistry(registry, "s-2");
    registry = setActiveSessionInRegistry(registry, "s-1");

    expect(registry.activeSessionId).toBe("s-1");
  });
});

describe("createPersistentRegistry: персистентность между экземплярами", () => {
  it("сессия, созданная одним экземпляром, восстанавливается другим (имитация перезагрузки)", () => {
    // Первый «цикл жизни страницы»
    const registryA = createPersistentRegistry(createLocalSessionRegistry());
    registryA.register("s-persist");

    // Данные в localStorage
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();

    // Второй «цикл жизни страницы» (перезагрузка): новый экземпляр
    const registryB = createPersistentRegistry(createLocalSessionRegistry());
    expect(registryB.has("s-persist")).toBe(true);
    expect(registryB.list()).toHaveLength(1);
    expect(registryB.list()[0]!.id).toBe("s-persist");
  });

  it("title первой реплики пользователя сохраняется и восстанавливается", () => {
    const registryA = createPersistentRegistry(createLocalSessionRegistry());
    registryA.register("s-title");
    registryA.recordUserMessage("s-title", "Счета за электричество выросли", "2026-11-16T12:00:00Z");

    // «Перезагрузка»
    const registryB = createPersistentRegistry(createLocalSessionRegistry());
    const restored = registryB.list()[0]!;
    expect(restored.title).toBe("Счета за электричество выросли");
  });

  it("touch обновляет updatedAt в localStorage", () => {
    const registryA = createPersistentRegistry(createLocalSessionRegistry());
    registryA.register("s-touch");
    registryA.touch("s-touch", "2026-11-16T13:00:00Z");

    const stored = loadSessionRegistry();
    expect(stored.sessions[0]!.updatedAt).toBe("2026-11-16T13:00:00Z");
  });

  it("повторный register той же сессии не создаёт дубликат", () => {
    const registry = createPersistentRegistry(createLocalSessionRegistry());
    registry.register("s-dup");
    registry.register("s-dup");

    const stored = loadSessionRegistry();
    expect(stored.sessions).toHaveLength(1);
  });

  it("recordUserMessage для неизвестной сессии — no-op без падения", () => {
    const registry = createPersistentRegistry(createLocalSessionRegistry());
    expect(() =>
      registry.recordUserMessage("unknown", "текст", "2026-11-16T12:00:00Z")
    ).not.toThrow();
  });

  it("недоступный localStorage: реестр работает в памяти без падения", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => {
      const registry = createPersistentRegistry(createLocalSessionRegistry());
      registry.register("s-mem");
      registry.recordUserMessage("s-mem", "вопрос", "2026-11-16T12:00:00Z");
      expect(registry.list()).toHaveLength(1);
      expect(registry.list()[0]!.title).toBe("вопрос");
    }).not.toThrow();
  });
});
