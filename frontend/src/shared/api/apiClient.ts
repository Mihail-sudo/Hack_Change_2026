import { API_BASE_URL } from "./config";

export type ApiErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "SERVER_ERROR"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, string[]>;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
}

export class ApiClientError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode?: number;
  /** Ошибки валидации по полям (из FastAPI 422 detail). */
  public readonly details?: Record<string, string[]>;

  constructor(
    code: ApiErrorCode,
    message: string,
    statusCode?: number,
    details?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Опции запроса: стандартный RequestInit + настраиваемый таймаут. */
export interface ApiRequestOptions extends RequestInit {
  /** Таймаут в мс (по умолчанию DEFAULT_TIMEOUT_MS). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Относительные пути дополняются базовым URL backend (см. shared/api/config).
 * Абсолютные URL передаются как есть — удобно для тестов и подмены.
 */
function buildUrl(endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

/** FastAPI отдаёт ошибки в формате {"detail": string} или {"detail": [...]} (422). */
interface FastApiErrorBody {
  detail?: string | Array<{ loc?: unknown[]; msg?: string }>;
  message?: string;
}

function parseErrorBody(body: unknown): {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, string[]>;
} | null {
  if (body === null || typeof body !== "object") return null;
  const errorBody = body as FastApiErrorBody;

  if (Array.isArray(errorBody.detail)) {
    // Ошибки валидации Pydantic: группируем сообщения по полям.
    const details: Record<string, string[]> = {};
    for (const item of errorBody.detail) {
      const field = item.loc?.filter((part) => part !== "body").join(".") ?? "unknown";
      (details[field] ??= []).push(item.msg ?? "некорректное значение");
    }
    return { code: "VALIDATION_ERROR", message: "Проверьте правильность данных", details };
  }
  if (typeof errorBody.detail === "string" && errorBody.detail) {
    return { code: "UNKNOWN", message: errorBody.detail };
  }
  if (typeof errorBody.message === "string" && errorBody.message) {
    return { code: "UNKNOWN", message: errorBody.message };
  }
  return null;
}

function errorCodeForStatus(status: number): ApiErrorCode {
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const parsed = parseErrorBody(await response.json().catch(() => null));

    // Код из тела приоритетен только для ошибок валидации (422-массив в detail);
    // остальное мапим по HTTP-статусу.
    const errorCode: ApiErrorCode =
      parsed?.code === "VALIDATION_ERROR"
        ? "VALIDATION_ERROR"
        : errorCodeForStatus(response.status);
    const errorMessage =
      parsed?.message ??
      (errorCode === "VALIDATION_ERROR"
        ? "Проверьте правильность данных"
        : `HTTP Error: ${response.status}`);

    throw new ApiClientError(errorCode, errorMessage, response.status, parsed?.details);
  }

  return response.json();
}

export async function apiClient<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // Отмена от вызывающего кода (например, смена сессии) тоже прерывает запрос.
  const externalSignal = options.signal ?? null;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const defaultHeaders: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const response = await fetch(buildUrl(endpoint), {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return handleResponse<T>(response);
  } catch (error) {
    clearTimeout(timeoutId);

    // DOMException в некоторых средах (jsdom) не instanceof Error — проверяем имя.
    const errorName =
      error instanceof Error
        ? error.name
        : (error as { name?: string } | null | undefined)?.name;

    if (errorName === "AbortError") {
      throw new ApiClientError("TIMEOUT", "Request timed out");
    }
    // Сетевая ошибка (сервер недоступен, CORS, DNS) — не показываем внутренности браузера.
    if (error instanceof Error) {
      throw new ApiClientError(
        "NETWORK_ERROR",
        "Не удалось подключиться к серверу. Проверьте подключение и попробуйте ещё раз."
      );
    }

    throw new ApiClientError("UNKNOWN", "An unknown error occurred");
  }
}
