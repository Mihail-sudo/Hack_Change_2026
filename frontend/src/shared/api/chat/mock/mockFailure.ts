import { ApiClientError } from "@/shared/api/apiClient";

/**
 * Управление симуляцией ошибок mock-сервиса (только для тестов и отладки UI).
 * Реальный backend это не касается.
 */

export type MockFailureMode =
  | { mode: "never" }
  | { mode: "always"; code?: "SERVER_ERROR" | "NETWORK_ERROR" }
  | { mode: "once" };

let failureMode: MockFailureMode = { mode: "never" };

export function setMockFailureMode(mode: MockFailureMode): void {
  failureMode = mode;
}

export function getMockFailureMode(): MockFailureMode {
  return failureMode;
}

/** Возвращает ошибку, если режим симуляции требует; "once" срабатывает один раз. */
export function consumeMockFailure(): ApiClientError | null {
  if (failureMode.mode === "always") {
    return new ApiClientError(failureMode.code ?? "SERVER_ERROR", "Симулированная ошибка mock-сервиса", 500);
  }
  if (failureMode.mode === "once") {
    failureMode = { mode: "never" };
    return new ApiClientError("SERVER_ERROR", "Симулированная ошибка mock-сервиса (однократная)", 500);
  }
  return null;
}
