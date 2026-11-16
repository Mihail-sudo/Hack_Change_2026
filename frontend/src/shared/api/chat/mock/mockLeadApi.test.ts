import { describe, it, expect } from "vitest";
import { createMockLeadApi } from "./mockLeadApi";
import { buildLeadSummary } from "../leadApi";

describe("createMockLeadApi", () => {
  const api = createMockLeadApi();

  it("mode — mock", () => {
    expect(api.mode).toBe("mock");
  });

  it("submitLead возвращает leadId и success=true", async () => {
    const result = await api.submitLead({
      fullName: "Иван Петров",
      phone: "+7 999 123-45-67",
      companyName: "ООО Энергия",
      sessionId: "session-123",
      summary: "Диалог о снижении затрат",
      need: "Снижение расходов",
      solutions: ["Почасовой учёт"],
      openQuestions: ["Точные объёмы"],
    });

    expect(result.success).toBe(true);
    expect(result.leadId).toMatch(/^lead-/);
  });

  it("пустой fullName выбрасывает ошибку", async () => {
    await expect(
      api.submitLead({
        fullName: "   ",
        phone: "+7 999 123-45-67",
        companyName: "ООО Энергия",
        sessionId: "session-123",
        summary: "Test",
        need: "Test",
        solutions: [],
        openQuestions: [],
      })
    ).rejects.toThrow("Не указано ФИО");
  });

  it("пустой phone выбрасывает ошибку", async () => {
    await expect(
      api.submitLead({
        fullName: "Иван",
        phone: "   ",
        companyName: "ООО",
        sessionId: "session-123",
        summary: "Test",
        need: "Test",
        solutions: [],
        openQuestions: [],
      })
    ).rejects.toThrow("Не указан телефон");
  });

  it("пустой companyName выбрасывает ошибку", async () => {
    await expect(
      api.submitLead({
        fullName: "Иван",
        phone: "+7 999 123-45-67",
        companyName: "  ",
        sessionId: "session-123",
        summary: "Test",
        need: "Test",
        solutions: [],
        openQuestions: [],
      })
    ).rejects.toThrow("Не указано название компании");
  });

  it("пустой sessionId выбрасывает ошибку", async () => {
    await expect(
      api.submitLead({
        fullName: "Иван",
        phone: "+7 999 123-45-67",
        companyName: "ООО",
        sessionId: "   ",
        summary: "Test",
        need: "Test",
        solutions: [],
        openQuestions: [],
      })
    ).rejects.toThrow("Нет идентификатора сессии");
  });
});

describe("buildLeadSummary", () => {
  it("извлекает потребность из первого сообщения", () => {
    const result = buildLeadSummary(
      [
        {
          id: "1",
          sessionId: "s1",
          role: "user",
          content: "У нас магазин, счета за электричество выросли",
          createdAt: new Date().toISOString(),
        },
      ],
      "s1"
    );
    expect(result.need).toBe("Снижение затрат на электроэнергию");
  });

  it("детектирует обсуждённые решения", () => {
    const result = buildLeadSummary(
      [
        {
          id: "1",
          sessionId: "s1",
          role: "user",
          content: "Есть почасовые данные",
          createdAt: new Date().toISOString(),
        },
        {
          id: "2",
          sessionId: "s1",
          role: "assistant",
          content: "Про анализ пиковых часов",
          createdAt: new Date().toISOString(),
        },
      ],
      "s1"
    );
    expect(result.solutions.some((s) => s.toLowerCase().includes("почасовые"))).toBe(true);
  });

  it("возвращает резюме с количеством сообщений", () => {
    const result = buildLeadSummary(
      [
        { id: "1", sessionId: "s1", role: "user", content: "Привет", createdAt: new Date().toISOString() },
        { id: "2", sessionId: "s1", role: "user", content: "Как дела?", createdAt: new Date().toISOString() },
      ],
      "s1"
    );
    expect(result.summary).toContain("2");
  });

  it("неизвестная потребность → консультация", () => {
    const result = buildLeadSummary(
      [{ id: "1", sessionId: "s1", role: "user", content: "Привет", createdAt: new Date().toISOString() }],
      "s1"
    );
    expect(result.need).toBe("Консультация по Energytool");
  });

  it("нет сообщений → новый диалог", () => {
    const result = buildLeadSummary([], "s1");
    expect(result.summary).toBe("Новый диалог без сообщений.");
  });
});
