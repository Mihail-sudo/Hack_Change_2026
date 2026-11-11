import { ApiClientError } from "@/shared/api/apiClient";
import type { ChatApi, SendMessageOptions } from "../types";
import type { SendMessageResponse } from "@/shared/types/chat";
/**
 * Заготовка live-реализации. Конкретные endpoint'ы НЕ согласованы с backend —
 * здесь намеренно нет URL. При попытке использования выбрасывает понятную ошибку,
 * чтобы live-режим нельзя было включить случайно.
 */
export function createLiveChatApi(): ChatApi {
  const notAvailable = (): never => {
    throw new ApiClientError(
      "SERVER_ERROR",
      "Backend чата ещё не подключён. Используйте mock-режим (VITE_CHAT_API=mock).",
      501
    );
  };

  return {
    mode: "live",
    createSession: notAvailable,
    listSessions: notAvailable,
    getSession: notAvailable,
    sendMessage: (_request: SendMessageOptions): Promise<SendMessageResponse> => notAvailable(),
  } satisfies ChatApi;
}
