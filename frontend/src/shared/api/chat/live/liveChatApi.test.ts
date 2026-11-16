/**
 * Тесты live-реализации ChatApi (реальные DTO backend'а из openapi.json).
 * fetch подменяется vi.fn() — тот же подход, что в apiClient.test.ts.
 * Проверяются: корректность DTO-маппинга, ошибки, сеть, таймаут/отмена.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiClientError } from "@/shared/api/apiClient";
import { API_BASE_URL } from "@/shared/api/config";
import { createLiveChatApi } from "./liveChatApi";
import type { ChatResponseDto, MessagesReadDto } from "./dto";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const chatResponse: ChatResponseDto = {
  reply: "Для учета по абонентам подходит облачная платформа АСКУЭ.",
  done: false,
  fallback: false,
  mode: "bot",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("liveChatApi.createSession", () => {
  it("не делает HTTP-запросов и генерирует локальный UUID (backend создаёт диалог при первом POST /chat)", async () => {
    const api = createLiveChatApi();
    const session = await api.createSession();

    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    expect(session.id).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(session.status).toBe("active");
    expect(session.messages).toEqual([]);
  });
});

describe("liveChatApi.sendMessage", () => {
  it("отправляет snake_case ChatRequestDto и маппит ChatResponseDto в доменное сообщение", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, chatResponse));
    vi.stubGlobal("fetch", fetchMock);

    const api = createLiveChatApi();
    const result = await api.sendMessage({ sessionId: SESSION_ID, content: "Как снизить счета?" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/chat`,
      expect.objectContaining({ method: "POST" })
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      session_id: SESSION_ID,
      message: "Как снизить счета?",
    });

    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toBe(chatResponse.reply);
    expect(result.message.status).toBe("complete");
    expect(typeof result.message.responseTimeMs).toBe("number");
    expect(result.message.responseTimeMs!).toBeGreaterThanOrEqual(0);
    // Backend не возвращает sources/quickReplies — они не выдумываются
    expect(result.message.sources).toBeUndefined();
    expect(result.message.quickReplies).toBeUndefined();
  });

  it("fallback=true из ChatResponse сохраняется в доменном сообщении", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { reply: "Запасной ответ", done: false, fallback: true, mode: "bot" })
      )
    );

    const api = createLiveChatApi();
    const result = await api.sendMessage({ sessionId: SESSION_ID, content: "текст" });

    expect(result.message.fallback).toBe(true);
  });

  it("пустой ответ в режиме admin (reply='') возвращается как есть — useChat убирает pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { reply: "", done: false, fallback: false, mode: "admin" })
      )
    );

    const api = createLiveChatApi();
    const result = await api.sendMessage({ sessionId: SESSION_ID, content: "Позовите оператора" });

    expect(result.message.content).toBe("");
  });

  it("ошибка валидации 422 → VALIDATION_ERROR с деталями полей", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          detail: [{ loc: ["body", "session_id"], msg: "String should match pattern" }],
        })
      )
    );

    const api = createLiveChatApi();
    await expect(
      api.sendMessage({ sessionId: "bad id!", content: "текст" })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 422,
      details: { "session_id": ["String should match pattern"] },
    });
  });

  it("ошибка сервера 500 c detail → SERVER_ERROR с текстом backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { detail: "Internal server error" }))
    );

    const api = createLiveChatApi();
    await expect(
      api.sendMessage({ sessionId: SESSION_ID, content: "текст" })
    ).rejects.toMatchObject({ code: "SERVER_ERROR", message: "Internal server error" });
  });

  it("недоступный backend (fetch reject) → NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const api = createLiveChatApi();
    await expect(
      api.sendMessage({ sessionId: SESSION_ID, content: "текст" })
    ).rejects.toBeInstanceOf(ApiClientError);
    await expect(
      api.sendMessage({ sessionId: SESSION_ID, content: "текст" })
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("отмена запроса (AbortSignal) → TIMEOUT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      )
    );

    const api = createLiveChatApi();
    const controller = new AbortController();
    const promise = api.sendMessage({
      sessionId: SESSION_ID,
      content: "текст",
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("liveChatApi.getSession", () => {
  it("маппит MessagesReadDto в ChatSession с серверными id сообщений", async () => {
    const dto: MessagesReadDto = {
      session_id: SESSION_ID,
      mode: "bot",
      messages: [
        {
          id: 7,
          role: "user",
          author: "client",
          content: "Счета выросли",
          created_at: "2026-11-15T10:00:00+00:00",
        },
        {
          id: 8,
          role: "assistant",
          author: "bot",
          content: "Разберёмся",
          created_at: "2026-11-15T10:00:05+00:00",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, dto)));

    const api = createLiveChatApi();
    const session = await api.getSession(SESSION_ID);

    expect(session.id).toBe(SESSION_ID);
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toMatchObject({
      id: "srv-7",
      serverId: 7,
      sessionId: SESSION_ID,
      role: "user",
      author: "client",
      content: "Счета выросли",
      createdAt: "2026-11-15T10:00:00+00:00",
    });
    expect(session.updatedAt).toBe("2026-11-15T10:00:05+00:00");
  });

  it("диалог без сообщений (backend отдаёт пустой список) → сессия без сообщений", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { session_id: SESSION_ID, mode: "bot", messages: [] })
      )
    );

    const api = createLiveChatApi();
    const session = await api.getSession(SESSION_ID);

    expect(session.messages).toEqual([]);
  });
});

describe("liveChatApi.listSessions", () => {
  it("возвращает сессии локального реестра БЕЗ вызова GET /admin/dialogs (небезопасен без авторизации)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    const api = createLiveChatApi();
    await api.createSession();
    const sessions = await api.listSessions();

    // Никаких HTTP-запросов: /admin/dialogs возвращает диалоги всех пользователей
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(sessions[0]!.messages).toEqual([]);
  });

  it("sendMessage фиксирует первую реплику пользователя как title сессии в реестре", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, chatResponse))
    );

    const api = createLiveChatApi();
    const session = await api.createSession();
    await api.sendMessage({ sessionId: session.id, content: "Счета за электричество выросли" });

    const sessions = await api.listSessions();
    expect(sessions[0]!.title).toBe("Счета за электричество выросли");
  });

  it("создаёт отдельные реестры для разных экземпляров api", async () => {
    const apiA = createLiveChatApi();
    const apiB = createLiveChatApi();
    await apiA.createSession();

    expect(await apiA.listSessions()).toHaveLength(1);
    expect(await apiB.listSessions()).toHaveLength(0);
  });
});

describe("liveChatApi.listNewMessages (поллинг оператора)", () => {
  it("передаёт курсор after_id и маппит MessagesReadDto с author", async () => {
    const dto: MessagesReadDto = {
      session_id: SESSION_ID,
      mode: "admin",
      messages: [
        {
          id: 11,
          role: "user",
          author: "client",
          content: "Позовите оператора",
          created_at: "2026-11-15T10:00:10+00:00",
        },
        {
          id: 12,
          role: "assistant",
          author: "admin",
          content: "Здравствуйте, я оператор МТС",
          created_at: "2026-11-15T10:00:20+00:00",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, dto));
    vi.stubGlobal("fetch", fetchMock);

    const api = createLiveChatApi();
    const result = await api.listNewMessages(SESSION_ID, 10);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/chat/${SESSION_ID}/messages?after_id=10`,
      expect.anything()
    );
    expect(result.mode).toBe("admin");
    expect(result.lastId).toBe(12);
    expect(result.messages[0]!.author).toBe("client");
    expect(result.messages[1]).toMatchObject({
      id: "srv-12",
      serverId: 12,
      role: "assistant",
      author: "admin",
      content: "Здравствуйте, я оператор МТС",
    });
  });

  it("пустой ответ сохраняет курсор без изменений", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { session_id: SESSION_ID, mode: "bot", messages: [] })
      )
    );

    const api = createLiveChatApi();
    const result = await api.listNewMessages(SESSION_ID, 42);

    expect(result.messages).toEqual([]);
    expect(result.lastId).toBe(42);
  });

  it("ошибка сети пробрасывается (поллинг обработает её сам, без тихого fallback)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const api = createLiveChatApi();
    await expect(api.listNewMessages(SESSION_ID, 0)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});

describe("liveChatApi.requestHandoff", () => {
  it("отправляет POST /chat/handoff с session_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const api = createLiveChatApi();
    await api.requestHandoff(SESSION_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/chat/handoff`,
      expect.objectContaining({ method: "POST" })
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ session_id: SESSION_ID });
  });

  it("ошибка валидации 422 пробрасывается как VALIDATION_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          detail: [{ loc: ["body", "session_id"], msg: "String should match pattern" }],
        })
      )
    );

    const api = createLiveChatApi();
    await expect(api.requestHandoff("bad id!")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 422,
    });
  });
});
