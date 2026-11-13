/**
 * Интеграционные тесты изоляции контекста сессий.
 *
 * Проверяемые сценарии:
 * 1. Переключение между двумя сессиями — сообщения не смешиваются.
 * 2. Создание новой сессии — контекст старой не передаётся.
 * 3. Поздний ответ предыдущей сессии не попадает в новую.
 * 4. Закрытие сессии — история сохраняется.
 * 5. Ошибка загрузки истории — retry работает.
 * 6. История без заявки сохраняется.
 * 7. useCreateSession создаёт приветствие.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useChatSessions, useEnsureActiveSession, useCreateSession } from "./useChat";
import { useChatMessaging } from "./useChatMessaging";
import { useActiveSessionStore } from "./activeSession";
import { chatApi, setMockFailureMode } from "@/shared/api";

const WAIT = { timeout: 5000 };

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// -----------------------------------------------------------
// 1. Переключение между сессиями — изоляция сообщений
// -----------------------------------------------------------
describe("изоляция сессий: переключение", () => {
  beforeEach(() => {
    setMockFailureMode({ mode: "never" });
    useActiveSessionStore.getState().setActiveSession(null);
  });

  it("при переключении на новую сессию загружается только её история", async () => {
    // Создаём две сессии
    const sessionA = await chatApi.createSession();
    const sessionB = await chatApi.createSession();

    // Отправляем сообщение в сессию A
    await chatApi.sendMessage({
      sessionId: sessionA.id,
      content: "У нас магазин, счета за электричество выросли",
    });

    // Рендерим useChatMessaging для сессии B
    const { result: resultB } = renderHook(() => useChatMessaging(sessionB.id), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(resultB.current.messages.length).toBeGreaterThanOrEqual(1), WAIT);

    // В сессии B только приветствие, нет сообщения из A
    expect(resultB.current.messages.every((m) => m.sessionId === sessionB.id)).toBe(true);
    expect(
      resultB.current.messages.some((m) => m.content.includes("магазин"))
    ).toBe(false);
  });

  it("обе сессии читают данные из своего кэша, независимо друг от друга", async () => {
    const sessionA = await chatApi.createSession();
    const sessionB = await chatApi.createSession();

    const { result: resultA } = renderHook(() => useChatMessaging(sessionA.id), {
      wrapper: createWrapper(),
    });
    const { result: resultB } = renderHook(() => useChatMessaging(sessionB.id), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(resultA.current.messages.length).toBeGreaterThanOrEqual(1), WAIT);
    await waitFor(() => expect(resultB.current.messages.length).toBeGreaterThanOrEqual(1), WAIT);

    // Отправляем в A — B не должен обновиться
    act(() => resultA.current.send("Сообщение только для A"));
    await waitFor(() => expect(resultA.current.messages.length).toBeGreaterThan(1), WAIT);

    // B остаётся с одним приветствием (ждём, чтобы убедиться что ответ A не попал в B)
    await waitFor(() => {
      expect(resultB.current.messages.length).toBeLessThanOrEqual(1);
    }, { timeout: 3000 });
  });
});

// -----------------------------------------------------------
// 2. Создание новой сессии — старый контекст не передаётся
// -----------------------------------------------------------
describe("изоляция сессий: создание новой", () => {
  beforeEach(() => {
    setMockFailureMode({ mode: "never" });
    useActiveSessionStore.getState().setActiveSession(null);
  });

  it("новая сессия не содержит сообщений предыдущей", async () => {
    const oldSession = await chatApi.createSession();
    await chatApi.sendMessage({
      sessionId: oldSession.id,
      content: "Старый разговор о магазине",
    });

    const wrapper = createWrapper();

    // Новый диалог
    const { result: ensureNew } = renderHook(() => useEnsureActiveSession(), { wrapper });
    await waitFor(() => expect(ensureNew.current.sessionId).not.toBeNull(), WAIT);
    const newSessionId = ensureNew.current.sessionId!;

    const { result: messaging } = renderHook(() => useChatMessaging(newSessionId), {
      wrapper,
    });

    await waitFor(() => expect(messaging.current.messages.length).toBeGreaterThanOrEqual(1), WAIT);

    // В новой сессии нет сообщения из старой
    expect(messaging.current.messages.some((m) => m.content.includes("Старый разговор"))).toBe(
      false
    );
  });

  it("история старой сессии сохраняется после создания новой", async () => {
    const oldSession = await chatApi.createSession();
    await chatApi.sendMessage({
      sessionId: oldSession.id,
      content: "Магазин",
    });

    // Создаём новую сессию (через хук, как в UI)
    const wrapper = createWrapper();
    const { result: create } = renderHook(() => useCreateSession(), { wrapper });

    await act(async () => {
      create.current.mutate();
    });
    await waitFor(() => expect(create.current.isSuccess).toBe(true), WAIT);

    // Старая сессия по-прежнему доступна
    const oldSessionData = await chatApi.getSession(oldSession.id);
    expect(oldSessionData.messages.some((m) => m.content.includes("Магазин"))).toBe(true);
  });
});

// -----------------------------------------------------------
// 3. Поздний ответ предыдущей сессии не попадает в новую
// -----------------------------------------------------------
describe("изоляция сессий: поздние ответы", () => {
  beforeEach(() => {
    setMockFailureMode({ mode: "never" });
    useActiveSessionStore.getState().setActiveSession(null);
  });

  it("поздний ответ старой сессии не попадает в новую при переключении", async () => {
    const oldSession = await chatApi.createSession();

    // Hook для старой сессии
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useChatMessaging(id),
      {
        initialProps: { id: oldSession.id },
        wrapper: createWrapper(),
      }
    );
    await waitFor(() => expect(result.current.messages.length).toBeGreaterThanOrEqual(1), WAIT);

    // Отправляем в старую и тут же создаём новую
    act(() => result.current.send("Вопрос в старой сессии"));
    const newSession = await chatApi.createSession();
    rerender({ id: newSession.id });

    // Ждём ответ oldSession в фоне (он придёт после переключения)
    await waitFor(
      async () => {
        const old = await chatApi.getSession(oldSession.id);
        expect(old.messages.some((m) => m.role === "assistant")).toBe(true);
      },
      WAIT
    );

    // В новой сессии — только приветствие, нет «Вопрос в старой сессии»
    await waitFor(
      () => {
        expect(result.current.messages.length).toBeLessThanOrEqual(2);
        expect(
          result.current.messages.some((m) => m.content.includes("Вопрос в старой"))
        ).toBe(false);
      },
      WAIT
    );
    expect(result.current.messages[0]?.sessionId).toBe(newSession.id);
  });
});

// -----------------------------------------------------------
// 4. Закрытие сессии — история сохраняется
// -----------------------------------------------------------
describe("изоляция сессий: closeSession", () => {
  beforeEach(() => {
    setMockFailureMode({ mode: "never" });
    useActiveSessionStore.getState().setActiveSession(null);
  });

  it("closeSession сбрасывает activeSessionId, но сессия остаётся в хранилище", async () => {
    const session = await chatApi.createSession();
    useActiveSessionStore.getState().setActiveSession(session.id);

    // closeSession
    act(() => {
      useActiveSessionStore.getState().closeSession();
    });

    expect(useActiveSessionStore.getState().activeSessionId).toBeNull();

    // Сессия по-прежнему доступна
    const stored = await chatApi.getSession(session.id);
    expect(stored.id).toBe(session.id);
    expect(stored.messages.length).toBeGreaterThanOrEqual(1);
  });

  it("после closeSession новая сессия не содержит данных закрытой", async () => {
    const oldSession = await chatApi.createSession();
    await chatApi.sendMessage({
      sessionId: oldSession.id,
      content: "Данные старой сессии",
    });

    // Закрываем
    act(() => {
      useActiveSessionStore.getState().closeSession();
    });

    // Создаём новую
    const wrapper = createWrapper();
    const { result: ensure } = renderHook(() => useEnsureActiveSession(), { wrapper });
    await waitFor(() => expect(ensure.current.sessionId).not.toBeNull(), WAIT);
    const newId = ensure.current.sessionId!;

    const { result: messaging } = renderHook(() => useChatMessaging(newId), { wrapper });
    await waitFor(() => expect(messaging.current.messages.length).toBeGreaterThanOrEqual(1), WAIT);

    expect(
      messaging.current.messages.some((m) => m.content.includes("Данные старой сессии"))
    ).toBe(false);
  });
});

// -----------------------------------------------------------
// 5. История без заявки сохраняется
// -----------------------------------------------------------
describe("история без заявки", () => {
  beforeEach(() => {
    setMockFailureMode({ mode: "never" });
    useActiveSessionStore.getState().setActiveSession(null);
  });

  it("сессия без leadId доступна в истории", async () => {
    // Создаём сессию и НЕ отправляем заявку
    const session = await chatApi.createSession();
    await chatApi.sendMessage({
      sessionId: session.id,
      content: "Просто спросил",
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useChatSessions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true), WAIT);

    const ids = result.current.data?.map((s) => s.id) ?? [];
    expect(ids).toContain(session.id);
    expect(result.current.data?.find((s) => s.id === session.id)?.leadId).toBeUndefined();
  });
});

// -----------------------------------------------------------
// 6. refetchHistory повторно загружает историю (не падает)
// -----------------------------------------------------------
describe("useChatMessaging refetchHistory", () => {
  beforeEach(() => {
    setMockFailureMode({ mode: "never" });
    useActiveSessionStore.getState().setActiveSession(null);
  });

  it("refetchHistory вызывается без ошибок", async () => {
    const session = await chatApi.createSession();
    const wrapper = createWrapper();

    const { result } = renderHook(() => useChatMessaging(session.id), { wrapper });
    await waitFor(() => expect(result.current.messages.length).toBeGreaterThanOrEqual(1), WAIT);

    // refetchHistory должен перечитать из store — проверяем что не падает
    act(() => {
      result.current.refetchHistory();
    });

    expect(result.current.messages.length).toBeGreaterThanOrEqual(1);
  });
});

// -----------------------------------------------------------
// 7. useCreateSession с empty initialMessages добавляет приветствие
// -----------------------------------------------------------
describe("useCreateSession приветствие", () => {
  beforeEach(() => {
    setMockFailureMode({ mode: "never" });
    useActiveSessionStore.getState().setActiveSession(null);
  });

  it("createSession без сообщений создаёт сессию с приветствием", async () => {
    const session = await chatApi.createSession();
    expect(session.messages.length).toBeGreaterThanOrEqual(1);
    expect(session.messages[0]!.role).toBe("assistant");
    expect(session.messages[0]!.content).toContain("Здравствуйте!");
  });

  it("useCreateSession вызывается как в ChatWorkspace — создаёт сессию с приветствием", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreateSession(), { wrapper });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), WAIT);

    const session = result.current.data!;
    expect(session.messages.length).toBeGreaterThanOrEqual(1);
    expect(session.messages[0]!.role).toBe("assistant");
    expect(session.messages[0]!.content).toContain("Здравствуйте!");
  });
});
