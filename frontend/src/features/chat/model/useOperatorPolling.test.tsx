/**
 * Тесты useOperatorPolling — поллинг операторских сообщений.
 *
 * chatApi подменяется vi.mock: проверяем только логику хука (курсор after_id,
 * дедупликация, смена сессии, ошибки сети, остановка при унмаунте).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useOperatorPolling } from "./useOperatorPolling";
import { chatKeys } from "./chatQueries";
import type { NewMessagesResult } from "@/shared/api/chat/types";
import type { ChatSession } from "@/shared/types/chat";

vi.mock("@/shared/api", () => ({
  chatApi: { listNewMessages: vi.fn() },
}));

import { chatApi } from "@/shared/api";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_SESSION_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6f";
const INTERVAL_MS = 20;

const mockedApi = vi.mocked(chatApi, true);

function listNewMessagesResult(overrides: Partial<NewMessagesResult> = {}): NewMessagesResult {
  return { mode: "bot", messages: [], lastId: 0, ...overrides };
}

function adminMessage(id: number): NewMessagesResult["messages"][number] {
  return {
    id: `srv-${id}`,
    serverId: id,
    sessionId: SESSION_ID,
    role: "assistant",
    author: "admin",
    content: `Реплика оператора ${id}`,
    createdAt: "2026-11-15T10:00:00+00:00",
    status: "complete",
  };
}

let queryClient: QueryClient;

function createWrapper() {
  // Один queryClient на тест: хук и проверки кэша используют один и тот же клиент.
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function seedSessionCache(sessionId: string) {
  const session: ChatSession = {
    id: sessionId,
    createdAt: "2026-11-15T10:00:00+00:00",
    updatedAt: "2026-11-15T10:00:00+00:00",
    status: "active",
    messages: [],
  };
  queryClient.setQueryData(chatKeys.session(sessionId), session);
  return session;
}

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mockedApi.listNewMessages.mockReset();
  mockedApi.listNewMessages.mockResolvedValue(listNewMessagesResult());
});

afterEach(() => {
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useOperatorPolling", () => {
  it("опрашивает GET-логику через chatApi.listNewMessages сразу при монтировании и по интервалу", async () => {
    renderHook(() => useOperatorPolling(SESSION_ID, { intervalMs: INTERVAL_MS }), {
      wrapper: createWrapper(),
    });

    await advance(0);
    expect(mockedApi.listNewMessages).toHaveBeenCalledWith(SESSION_ID, 0, expect.anything());

    await advance(INTERVAL_MS * 2);
    expect(mockedApi.listNewMessages.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Курсор после пустых ответов остаётся 0
    expect(mockedApi.listNewMessages).toHaveBeenLastCalledWith(SESSION_ID, 0, expect.anything());
  });

  it("не опрашивает при sessionId = null", async () => {
    renderHook(() => useOperatorPolling(null, { intervalMs: INTERVAL_MS }), {
      wrapper: createWrapper(),
    });

    await advance(INTERVAL_MS * 3);
    expect(mockedApi.listNewMessages).not.toHaveBeenCalled();
  });

  it("добавляет реплики оператора в кэш сессии и передаёт режим диалога", async () => {
    const { result } = renderHook(() => useOperatorPolling(SESSION_ID, { intervalMs: INTERVAL_MS }), {
      wrapper: createWrapper(),
    });
    seedSessionCache(SESSION_ID);

    mockedApi.listNewMessages.mockResolvedValue(
      listNewMessagesResult({
        mode: "admin",
        messages: [adminMessage(5)],
        lastId: 5,
      })
    );

    await advance(INTERVAL_MS * 2);

    const session = queryClient.getQueryData<ChatSession>(chatKeys.session(SESSION_ID));
    expect(session?.messages.map((m) => m.id)).toEqual(["srv-5"]);
    expect(result.current.dialogMode).toBe("admin");
  });

  it("не дублирует сообщения при повторных опросах (курсор after_id продвигается)", async () => {
    renderHook(() => useOperatorPolling(SESSION_ID, { intervalMs: INTERVAL_MS }), {
      wrapper: createWrapper(),
    });
    seedSessionCache(SESSION_ID);

    mockedApi.listNewMessages.mockResolvedValue(
      listNewMessagesResult({ mode: "admin", messages: [adminMessage(5)], lastId: 5 })
    );
    await advance(INTERVAL_MS * 2);

    mockedApi.listNewMessages.mockResolvedValue(
      listNewMessagesResult({ mode: "admin", messages: [adminMessage(5), adminMessage(6)], lastId: 6 })
    );
    await advance(INTERVAL_MS * 2);

    const session = queryClient.getQueryData<ChatSession>(chatKeys.session(SESSION_ID));
    const ids = session!.messages.map((m) => m.id);
    expect(ids).toEqual(["srv-5", "srv-6"]);
    // Следующий запрос уходит с курсором 6, а не 0
    expect(mockedApi.listNewMessages).toHaveBeenLastCalledWith(SESSION_ID, 6, expect.anything());
  });

  it("смена сессии: курсор сбрасывается, поздний ответ старой сессии не попадает в новую", async () => {
    // Зависший запрос старой сессии: резолвится уже после переключения
    let resolveOld: (value: NewMessagesResult) => void = () => {};
    mockedApi.listNewMessages.mockImplementationOnce(
      () =>
        new Promise<NewMessagesResult>((resolve) => {
          resolveOld = resolve;
        })
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useOperatorPolling(id, { intervalMs: INTERVAL_MS }),
      { initialProps: { id: SESSION_ID }, wrapper: createWrapper() }
    );
    seedSessionCache(SESSION_ID);
    seedSessionCache(OTHER_SESSION_ID);

    await advance(0);
    expect(mockedApi.listNewMessages).toHaveBeenCalledWith(SESSION_ID, 0, expect.anything());

    // Переключаемся на другую сессию — in-flight запрос старой прерывается по abort
    rerender({ id: OTHER_SESSION_ID });
    await advance(0);
    expect(mockedApi.listNewMessages).toHaveBeenCalledWith(OTHER_SESSION_ID, 0, expect.anything());
    expect(result.current.dialogMode).toBe("bot");

    // Поздний ответ старой сессии
    resolveOld(listNewMessagesResult({ mode: "admin", messages: [adminMessage(9)], lastId: 9 }));
    await advance(0);

    const oldSession = queryClient.getQueryData<ChatSession>(chatKeys.session(SESSION_ID));
    const newSession = queryClient.getQueryData<ChatSession>(chatKeys.session(OTHER_SESSION_ID));
    expect(oldSession!.messages).toEqual([]);
    expect(newSession!.messages).toEqual([]);
  });

  it("сетевые ошибки не ломают поллинг: запросы продолжаются с бэкоффом", async () => {
    const { result } = renderHook(() => useOperatorPolling(SESSION_ID, { intervalMs: INTERVAL_MS }), {
      wrapper: createWrapper(),
    });
    seedSessionCache(SESSION_ID);

    mockedApi.listNewMessages.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
    await advance(0);
    expect(result.current.dialogMode).toBe("bot");

    // Первый интервал удвоен (backoff): тик на INTERVAL_MS не происходит.
    await advance(INTERVAL_MS);
    expect(queryClient.getQueryData<ChatSession>(chatKeys.session(SESSION_ID))?.messages).toEqual(
      []
    );

    // Следующий тик после бэкоффа успешен и сбрасывает задержку
    mockedApi.listNewMessages.mockResolvedValueOnce(
      listNewMessagesResult({ mode: "admin", messages: [adminMessage(3)], lastId: 3 })
    );
    // Тик после бэкоффа успешен и сбрасывает задержку
    await advance(INTERVAL_MS * 2);

    const session = queryClient.getQueryData<ChatSession>(chatKeys.session(SESSION_ID));
    expect(session?.messages.map((m) => m.id)).toEqual(["srv-3"]);
    expect(result.current.dialogMode).toBe("admin");
  });

  it("унмаунт останавливает поллинг", async () => {
    const { unmount } = renderHook(() => useOperatorPolling(SESSION_ID, { intervalMs: INTERVAL_MS }), {
      wrapper: createWrapper(),
    });

    await advance(0);
    const callsAfterMount = mockedApi.listNewMessages.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThanOrEqual(1);

    unmount();
    await advance(INTERVAL_MS * 5);

    expect(mockedApi.listNewMessages.mock.calls.length).toBe(callsAfterMount);
  });
});
