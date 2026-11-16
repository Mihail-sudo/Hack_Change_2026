import type { ChatMessage } from "@/shared/types/chat";

export interface SubmitLeadRequest {
  fullName: string;
  phone: string;
  companyName: string;
  sessionId: string;
  /** Краткое резюме диалога. */
  summary: string;
  /** Основная потребность клиента. */
  need: string;
  /** Обсуждавшиеся решения Energytool. */
  solutions: string[];
  /** Нерешённые вопросы. */
  openQuestions: string[];
}

export interface SubmitLeadResponse {
  leadId: string;
  success: boolean;
}

/**
 * Контракт для отправки заявки менеджеру.
 * Изолирован от ChatApi: можно подменить независимо.
 */
export interface LeadApi {
  /** "mock" — заявка сохраняется в память браузера. */
  readonly mode: "mock" | "live";
  submitLead(request: SubmitLeadRequest, signal?: AbortSignal): Promise<SubmitLeadResponse>;
}

/**
 * Генерирует краткое резюме диалога для заявки.
 * Вызывается перед отправкой — изолированно, без побочных эффектов.
 */
export function buildLeadSummary(
  messages: ChatMessage[],
  _sessionId: string
): {
  summary: string;
  need: string;
  solutions: string[];
  openQuestions: string[];
} {
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  const firstUserMsg = userMessages[0]?.content ?? "";
  const lastAssistantMsg = assistantMessages[assistantMessages.length - 1]?.content ?? "";

  // Простая эвристика: выделяем ключевые слова
  const needKeywords = [
    "счёт", "счета", "счет", "расход", "дорого", "снизить", "оптимизировать", "тариф", "потребление", "рост",
  ];
  const hasNeed = needKeywords.some((kw) => firstUserMsg.toLowerCase().includes(kw));

  // Собираем обсуждённые решения
  const discussedSolutions: string[] = [];
  const solutionMentions: Record<string, boolean> = {
    "почасовые данные": false,
    "автоматический учёт": false,
    "пиковые часы": false,
    "ценовая категория": false,
    "счётчик": false,
    "база знаний": false,
  };

  for (const msg of [...userMessages, ...assistantMessages]) {
    for (const kw of Object.keys(solutionMentions)) {
      if (msg.content.toLowerCase().includes(kw)) {
        solutionMentions[kw] = true;
      }
    }
  }

  for (const [kw, found] of Object.entries(solutionMentions)) {
    if (found) {
      discussedSolutions.push(kw.charAt(0).toUpperCase() + kw.slice(1));
    }
  }

  if (discussedSolutions.length === 0) {
    discussedSolutions.push("Требуется уточнение у менеджера");
  }

  return {
    summary:
      userMessages.length > 0
        ? `Диалог из ${userMessages.length} сообщений. Последний ответ: ${lastAssistantMsg.slice(0, 120)}…`
        : "Новый диалог без сообщений.",
    need: hasNeed ? "Снижение затрат на электроэнергию" : "Консультация по Energytool",
    solutions: discussedSolutions,
    openQuestions:
      assistantMessages.length < 2
        ? ["Требуется уточнение потребности"]
        : [],
  };
}
