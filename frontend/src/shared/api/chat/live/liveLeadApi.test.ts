/**
 * Тесты live-реализации LeadApi: явный маппинг SubmitLeadRequest → LeadCreateDto
 * (backend не имеет полей company/sessionId/summary/need/solutions/openQuestions —
 * они собираются в question) и обработка ошибок.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { API_BASE_URL } from "@/shared/api/config";
import { createLiveLeadApi, buildLeadQuestion } from "./liveLeadApi";
import type { LeadReadDto } from "./dto";

const baseRequest = {
  fullName: "Иван Петров",
  phone: "+7 900 000-00-00",
  companyName: "СНТ «Рассвет»",
  sessionId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  summary: "Диалог из 3 сообщений. Последний ответ: Подходит облачная АСКУЭ…",
  need: "Учёт потребления по абонентам",
  solutions: ["Облачная платформа учёта"],
  openQuestions: ["Количество участков"],
};

const leadCreated: LeadReadDto = {
  id: 42,
  status: "delivered",
  created_at: "2026-11-15T12:00:00+00:00",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify(leadCreated), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    })
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("liveLeadApi.submitLead — маппинг DTO", () => {
  it("отправляет LeadCreateDto: name, contact, contact_type=phone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(leadCreated), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const api = createLiveLeadApi();
    await api.submitLead(baseRequest);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/leads`,
      expect.objectContaining({ method: "POST" })
    );
    const dto = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(dto).toEqual({
      question: expect.stringContaining("СНТ «Рассвет»"),
      name: "Иван Петров",
      contact: "+7 900 000-00-00",
      contact_type: "phone",
    });
  });

  it("question содержит компанию, задачу, резюме и sessionId (полей нет в backend)", async () => {
    const question = buildLeadQuestion(baseRequest);
    expect(question).toContain(`Компания: ${baseRequest.companyName}`);
    expect(question).toContain(`Задача: ${baseRequest.need}`);
    expect(question).toContain(`Резюме диалога: ${baseRequest.summary}`);
    expect(question).toContain("Обсуждалось: Облачная платформа учёта");
    expect(question).toContain("Уточнить у менеджера: Количество участков");
    expect(question).toContain(`Сессия: ${baseRequest.sessionId}`);
  });

  it("question не превышает 2000 символов даже при длинных данных", () => {
    const longRequest = {
      ...baseRequest,
      summary: "х".repeat(5000),
      solutions: ["х".repeat(500)],
    };
    expect(buildLeadQuestion(longRequest).length).toBeLessThanOrEqual(2000);
  });

  it("201 LeadReadDto → { leadId: '42', success: true }", async () => {
    const api = createLiveLeadApi();
    const result = await api.submitLead(baseRequest);
    expect(result).toEqual({ leadId: "42", success: true });
  });
});

describe("liveLeadApi.submitLead — ошибки", () => {
  it("ошибка сервера 500 → SERVER_ERROR, данные не теряются (бросок, а не success=false)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Internal server error" }), { status: 500 })
    ));

    const api = createLiveLeadApi();
    await expect(api.submitLead(baseRequest)).rejects.toMatchObject({
      code: "SERVER_ERROR",
      statusCode: 500,
    });
  });

  it("ошибка валидации 422 → VALIDATION_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ detail: [{ loc: ["body", "contact"], msg: "must not be blank" }] }),
        { status: 422 }
      )
    ));

    const api = createLiveLeadApi();
    await expect(api.submitLead(baseRequest)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("недоступный backend → NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const api = createLiveLeadApi();
    await expect(api.submitLead(baseRequest)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
