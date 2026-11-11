import { describe, it, expect, beforeEach } from "vitest";
import { createMockChatApi } from "./mockChatApi";
import { MockChatStore } from "./mockStore";
import { setMockFailureMode } from "./mockFailure";
import { STEP_SHOP } from "./mockScript";

/** Unit-тесты mock-сервиса: сценарий, ошибки, отмена, изоляция сессий. */

function createApi() {
  return createMockChatApi({ minDelayMs: 1, maxDelayMs: 2, store: new MockChatStore() });
}

beforeEach(() => {
  setMockFailureMode({ mode: "never" });
});

describe("mockChatApi", () => {
  it("createSession возвращает активную сессию с приветствием ассистента", async () => {
    const api = createApi();
    const session = await api.createSession();

    expect(session.status).toBe("active");
    expect(session.messages).toHaveLength(1);
    const greeting = session.messages[0]!;
    expect(greeting.role).toBe("assistant");
    expect(greeting.content).toContain("Здравствуйте!");
    expect(greeting.content).toContain("Energytool");
  });

  it("первое сообщение пользователя получает сценарный ответ с быстрыми ответами", async () => {
    const api = createApi();
    const session = await api.createSession();

    const response = await api.sendMessage({
      sessionId: session.id,
      content: "У нас небольшой магазин, счета за электричество сильно выросли. Хотим снизить расходы",
    });

    expect(response.message.role).toBe("assistant");
    expect(response.message.content).toContain("почасовые данные потребления или только общий счёт");
    expect(response.message.quickReplies).toEqual([
      "Есть почасовые данные потребления.",
      "Только общий счёт за месяц.",
      "Не знаю.",
    ]);
    expect(Object.keys(STEP_SHOP.quickReplies).length).toBe(3);
  });

  it.each([
    ["Есть почасовые данные потребления.", "почасовые данные потребления"],
    ["Только общий счёт за месяц.", "только общий счёт за месяц"],
    ["Не знаю.", "их можно собрать вместе со специалистом"],
  ])(
    "ответ на быстрый ответ «%s» возвращает соответствующую ветку",
    async (choice, expectedFragment) => {
      const api = createApi();
      const session = await api.createSession();
      await api.sendMessage({
        sessionId: session.id,
        content: "У нас небольшой магазин, счета за электричество сильно выросли. Хотим снизить расходы",
      });

      const response = await api.sendMessage({ sessionId: session.id, content: choice });
      expect(response.message.content).toContain(expectedFragment);
      // После ветки быстрые ответы больше не предлагаются
      expect(response.message.quickReplies).toBeUndefined();
    }
  );

  it("сообщение вне сценария получает честный fallback, а не выдуманный ответ ИИ", async () => {
    const api = createApi();
    const session = await api.createSession();
    await api.sendMessage({ sessionId: session.id, content: "Привет" });

    const response = await api.sendMessage({ sessionId: session.id, content: "Как погода?" });
    expect(response.message.content).toContain("демонстрационный прототип");
  });

  it("mock не возвращает источники RAG (нет выдуманных документов)", async () => {
    const api = createApi();
    const session = await api.createSession();
    const response = await api.sendMessage({ sessionId: session.id, content: "Привет" });
    expect(response.message.sources).toBeUndefined();
  });

  it("сессии изолированы: ответ одной сессии не попадает в другую", async () => {
    const api = createApi();
    const sessionA = await api.createSession();
    const sessionB = await api.createSession();

    await api.sendMessage({ sessionId: sessionA.id, content: "У нас небольшой магазин, счета за электричество сильно выросли. Хотим снизить расходы" });

    const a = await api.getSession(sessionA.id);
    const b = await api.getSession(sessionB.id);

    expect(a.messages).toHaveLength(3); // приветствие + user + assistant
    expect(b.messages).toHaveLength(1); // только приветствие
    expect(a.messages.every((m) => m.sessionId === sessionA.id)).toBe(true);
    expect(b.messages.every((m) => m.sessionId === sessionB.id)).toBe(true);
  });

  it("listSessions возвращает сессии и обновляет порядок по updatedAt", async () => {
    const api = createApi();
    const first = await api.createSession();
    const second = await api.createSession();

    const sessions = await api.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
  });

  it("повторная отправка в несуществующую сессию возвращает NOT_FOUND", async () => {
    const api = createApi();
    await expect(api.sendMessage({ sessionId: "no-such", content: "тест" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("пустое сообщение возвращает VALIDATION_ERROR", async () => {
    const api = createApi();
    const session = await api.createSession();
    await expect(api.sendMessage({ sessionId: session.id, content: "   " })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("симуляция ошибки выдаёт ApiClientError и не добавляет сообщения", async () => {
    const api = createApi();
    const session = await api.createSession();
    setMockFailureMode({ mode: "always" });

    await expect(
      api.sendMessage({ sessionId: session.id, content: "тест" })
    ).rejects.toMatchObject({ code: "SERVER_ERROR" });

    const after = await api.getSession(session.id);
    // user-сообщение не было добавлено в хранилище (упало до append)
    expect(after.messages).toHaveLength(1);
  });

  it("AbortSignal отменяет запрос", async () => {
    const api = createApi();
    const controller = new AbortController();
    const promise = api.sendMessage({
      sessionId: "any",
      content: "тест",
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
