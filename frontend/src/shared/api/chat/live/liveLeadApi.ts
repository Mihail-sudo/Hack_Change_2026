import { apiClient } from "@/shared/api/apiClient";
import type { LeadApi, SubmitLeadRequest, SubmitLeadResponse } from "../leadApi";
import type { LeadCreateDto, LeadReadDto } from "./dto";
import { toLeadSubmissionResult } from "./mapping";

/**
 * Live-реализация LeadApi: POST /leads (бэкенд-контракт из аудита).
 *
 * Backend принимает {question, name?, contact, contact_type} и НЕ имеет полей
 * company / sessionId / summary / need / solutions / openQuestions и согласия
 * (152-ФЗ) — контракт v0.6 (POST /lead) backend'ом ещё не реализован.
 * Поэтому все данные явно собираются в текст question (см. buildLeadQuestion).
 * Телефон передаётся строкой: "+", форматирование и ведущие символы сохраняются.
 */

const MAX_QUESTION_LENGTH = 2000; // ограничение backend (LeadCreate.question)
const MAX_NAME_LENGTH = 100; // ограничение backend (LeadCreate.name)

/**
 * Явная карта преобразования заявки frontend → DTO backend:
 *   fullName      → name      (обрезка до 100 символов)
 *   phone         → contact   (contact_type = "phone")
 *   companyName,
 *   need, summary,
 *   solutions,
 *   openQuestions,
 *   sessionId     → question  (структурированный текст ≤ 2000 символов)
 */
export function buildLeadQuestion(request: SubmitLeadRequest): string {
  const lines = [
    `Компания: ${request.companyName}`,
    `Задача: ${request.need}`,
    `Резюме диалога: ${request.summary}`,
  ];
  if (request.solutions.length > 0) {
    lines.push(`Обсуждалось: ${request.solutions.join(", ")}`);
  }
  if (request.openQuestions.length > 0) {
    lines.push(`Уточнить у менеджера: ${request.openQuestions.join("; ")}`);
  }
  lines.push(`Сессия: ${request.sessionId}`);

  const question = lines.join("\n");
  return question.length > MAX_QUESTION_LENGTH
    ? `${question.slice(0, MAX_QUESTION_LENGTH - 1)}…`
    : question;
}

export function createLiveLeadApi(): LeadApi {
  return {
    mode: "live",

    async submitLead(
      request: SubmitLeadRequest,
      signal?: AbortSignal
    ): Promise<SubmitLeadResponse> {
      const dto: LeadCreateDto = {
        question: buildLeadQuestion(request),
        name: request.fullName.slice(0, MAX_NAME_LENGTH),
        contact: request.phone,
        contact_type: "phone",
      };

      const result = await apiClient<LeadReadDto>("/leads", {
        method: "POST",
        body: JSON.stringify(dto),
        signal,
      });

      // Успех фиксируем только по 2xx от backend: LeadRead {id, status, created_at}.
      return toLeadSubmissionResult(result);
    },
  } satisfies LeadApi;
}
