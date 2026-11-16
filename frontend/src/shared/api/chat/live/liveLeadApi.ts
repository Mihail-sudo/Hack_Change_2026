import { ApiClientError } from "@/shared/api/apiClient";
import type { LeadApi, SubmitLeadRequest } from "../leadApi";

/**
 * Заготовка live-реализации. Конкретные endpoint'ы НЕ согласованы с backend.
 * При попытке использования выбрасывает понятную ошибку.
 */
export function createLiveLeadApi(): LeadApi {
  const notAvailable = (): never => {
    throw new ApiClientError(
      "SERVER_ERROR",
      "Backend заявок ещё не подключён. Используйте mock-режим.",
      501
    );
  };

  return {
    mode: "live",
    submitLead: (_request: SubmitLeadRequest) => notAvailable(),
  };
}
