import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useChatSessions, useEnsureActiveSession } from "./useChat";
import { useChatMessaging } from "./useChatMessaging";

import { useActiveSessionStore } from "./activeSession";
import { chatApi, setMockFailureMode } from "@/shared/api";

const WAIT = { timeout: 4000 };

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  setMockFailureMode({ mode: "never" });
  useActiveSessionStore.getState().setActiveSession(null);
});

describe("useEnsureActiveSession", () => {
  it("создаёт сессию и выставляет её активной", async () => {
    const { result } = renderHook(() => useEnsureActiveSession(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.sessionId).not.toBeNull(), WAIT);
    expect(useActiveSessionStore.getState().activeSessionId).toBe(result.current.sessionId);

    const session = await chatApi.getSession(result.current.sessionId!);
    expect(session.messages[0]?.content).toContain("Здравствуйте!");
  });
});

describe("useChatMessaging", () => {
  it("отправка: пользователь → ожидание → ответ ассистента", async () => {
    const ensure = renderHook(() => useEnsureActiveSession(), { wrapper: createWrapper() });
    await waitFor(() => expect(ensure.result.current.sessionId).not.toBeNull(), WAIT);
    const sessionId = ensure.result.current.sessionId!;

    const { result } = renderHook(() => useChatMessaging(sessionId), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.messages.length).toBe(1), WAIT);

    act(() => result.current.send("У нас небольшой магазин, счета за электричество сильно выросли. Хотим снизить расходы"));

    // Сразу после отправки видно пользовательское сообщение и pending
    await waitFor(() => expect(result.current.messages.length).toBe(3), WAIT);
    const [user, pending] = result.current.messages.slice(1);
    expect(user?.role).toBe("user");
    expect(user?.content).toContain("магазин");
    expect(pending?.status).toBe("pending");

    // Ответ ассистента заменяет pending
    await waitFor(
      () => {
        const assistant = result.current.messages[2];
        expect(assistant?.role).toBe("assistant");
        expect(assistant?.status).toBe("complete");
      },
      WAIT
    );
    expect(result.current.messages[2]?.content).toContain("почасовые данные потребления");
    expect(result.current.hasPending).toBe(false);
    expect(result.current.quickReplies).toHaveLength(3);
  });

  it("повторная отправка блокируется, пока ассистент отвечает", async () => {
    const ensure = renderHook(() => useEnsureActiveSession(), { wrapper: createWrapper() });
    await waitFor(() => expect(ensure.result.current.sessionId).not.toBeNull(), WAIT);
    const sessionId = ensure.result.current.sessionId!;

    const { result } = renderHook(() => useChatMessaging(sessionId), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.messages.length).toBe(1), WAIT);

    act(() => result.current.send("У нас небольшой магазин, счета за электричество сильно выросли. Хотим снизить расходы"));
    await waitFor(() => expect(result.current.hasPending).toBe(true), WAIT);

    act(() => result.current.send("Второе сообщение"));
    await waitFor(() => expect(result.current.hasPending).toBe(false), WAIT);

    // Второе сообщение не было отправлено
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("ошибка отправки: сообщение помечается error, retry успешен, дубликата нет", async () => {
    const ensure = renderHook(() => useEnsureActiveSession(), { wrapper: createWrapper() });
    await waitFor(() => expect(ensure.result.current.sessionId).not.toBeNull(), WAIT);
    const sessionId = ensure.result.current.sessionId!;

    const { result } = renderHook(() => useChatMessaging(sessionId), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.messages.length).toBe(1), WAIT);

    setMockFailureMode({ mode: "once" });
    act(() => result.current.send("У нас небольшой магазин, счета за электричество сильно выросли. Хотим снизить расходы"));

    await waitFor(() => expect(result.current.lastFailed).not.toBeNull(), WAIT);
    expect(result.current.lastFailed?.status).toBe("error");
    // pending-заглушка удалена после ошибки
    expect(result.current.messages.some((m) => m.status === "pending")).toBe(false);

    // Повтор — успех, дубликатов нет
    act(() => result.current.retry());
    await waitFor(
      () => {
        const assistant = result.current.messages.find(
          (m) =>
            m.role === "assistant" &&
            m.status === "complete" &&
            m.id !== result.current.messages[0]?.id
        );
        return assistant !== undefined;
      },
      WAIT
    );
    await waitFor(() => expect(result.current.lastFailed).toBeNull(), WAIT);

    const userMessages = result.current.messages.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.status).not.toBe("error");
  });

  it("поздний ответ старой сессии не появляется в новой сессии", async () => {
    const oldSession = await chatApi.createSession();

    // Один хук: sessionId переключается так же, как это делает UI
    const { result, rerender } = renderHook(({ id }) => useChatMessaging(id), {
      initialProps: { id: oldSession.id },
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.messages.length).toBe(1), WAIT);

    // Отправка в старую сессию и немедленное переключение на новую
    act(() => result.current.send("Вопрос в старой сессии"));
    const newSession = await chatApi.createSession();
    rerender({ id: newSession.id });

    // Даём ответу старой сессии время прийти
    await waitFor(
      async () => {
        const old = await chatApi.getSession(oldSession.id);
        expect(old.messages.some((m) => m.role === "assistant")).toBe(true);
      },
      WAIT
    );

    // В новой сессии только её приветствие — чужих сообщений нет
    await waitFor(() => expect(result.current.messages.length).toBe(1), WAIT);
    expect(result.current.messages[0]?.sessionId).toBe(newSession.id);
    expect(
      result.current.messages.some((m) => m.content.includes("Вопрос в старой"))
    ).toBe(false);
  }, 15000);
});

describe("useChatSessions", () => {
  it("возвращает список сессий после создания новой", async () => {
    const { result } = renderHook(() => useChatSessions(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), WAIT);
    expect(result.current.data!.length).toBeGreaterThanOrEqual(2);
  });
});

