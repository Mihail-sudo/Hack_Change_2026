import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveChatApi } from "./liveChatApi";
import { createLiveLeadApi } from "./liveLeadApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("liveChatApi", () => {
  it("отправляет сообщение в backend и возвращает ответ агента", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      reply: "Ответ настоящего агента",
      done: false,
      fallback: false,
      mode: "bot",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createLiveChatApi().sendMessage({
      sessionId: "session-123",
      content: "Как снизить расходы?",
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/chat", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ session_id: "session-123", message: "Как снизить расходы?" }),
    }));
    expect(result.message.content).toBe("Ответ настоящего агента");
    expect(result.message.role).toBe("assistant");
  });

  it("загружает и преобразует историю сообщений", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      session_id: "session-123",
      mode: "bot",
      messages: [{
        id: 7,
        role: "assistant",
        author: "bot",
        content: "Сохранённый ответ",
        created_at: "2026-11-16T12:00:00Z",
      }],
    })));

    const session = await createLiveChatApi().getSession("session-123");

    expect(session.messages).toEqual([expect.objectContaining({
      id: "7",
      sessionId: "session-123",
      content: "Сохранённый ответ",
      status: "complete",
    })]);
  });
});

describe("liveLeadApi", () => {
  it("создаёт заявку через backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 42,
      status: "new",
      created_at: "2026-11-16T12:00:00Z",
    }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createLiveLeadApi().submitLead({
      fullName: "Иван Петров",
      phone: "+7 999 123-45-67",
      companyName: "ООО Энергия",
      sessionId: "session-123",
      summary: "Нужен аудит энергопотребления",
      need: "Снижение расходов",
      solutions: [],
      openQuestions: [],
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/leads", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        question: "Нужен аудит энергопотребления",
        name: "Иван Петров",
        contact: "+7 999 123-45-67",
        contact_type: "phone",
      }),
    }));
    expect(result).toEqual({ leadId: "42", success: true });
  });

  it("не считает отклонённую backend заявку успешной", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "invalid" }, 422)));

    await expect(createLiveLeadApi().submitLead({
      fullName: "Иван Петров",
      phone: "+7 999 123-45-67",
      companyName: "ООО Энергия",
      sessionId: "session-123",
      summary: "Заявка",
      need: "Консультация",
      solutions: [],
      openQuestions: [],
    })).rejects.toMatchObject({ statusCode: 422 });
  });
});
