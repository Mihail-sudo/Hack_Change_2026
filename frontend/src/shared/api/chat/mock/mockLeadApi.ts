import type { LeadApi, SubmitLeadRequest, SubmitLeadResponse } from "../leadApi";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockLeadApi(): LeadApi {
  return {
    mode: "mock",

    async submitLead(request: SubmitLeadRequest, signal?: AbortSignal): Promise<SubmitLeadResponse> {
      // Simulate network delay
      await delay(400);

      if (signal?.aborted) {
        throw new DOMException("Запрос отменён", "AbortError");
      }

      const { fullName, phone, companyName, sessionId } = request;

      // Basic validation
      if (!fullName.trim()) throw new Error("Не указано ФИО");
      if (!phone.trim()) throw new Error("Не указан телефон");
      if (!companyName.trim()) throw new Error("Не указано название компании");
      if (!sessionId?.trim()) throw new Error("Нет идентификатора сессии");

      // Log sanitized data — no personal data in production logs
      console.debug(`[mockLeadApi] Заявка создана: sessionId=${sessionId}, company=${companyName}`);

      return {
        leadId: `lead-${Date.now()}-mock`,
        success: true,
      };
    },
  };
}
