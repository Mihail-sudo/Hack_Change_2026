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

  constructor(code: ApiErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorCode: ApiErrorCode = "UNKNOWN";
    let errorMessage = `HTTP Error: ${response.status}`;

    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch {
      // Response body is not JSON
    }

    if (response.status === 401) errorCode = "UNAUTHORIZED";
    else if (response.status === 404) errorCode = "NOT_FOUND";
    else if (response.status >= 500) errorCode = "SERVER_ERROR";

    throw new ApiClientError(errorCode, errorMessage, response.status);
  }

  return response.json();
}

export async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  const defaultHeaders: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const response = await fetch(endpoint, {
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

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new ApiClientError("TIMEOUT", "Request timed out");
      }
      throw new ApiClientError("NETWORK_ERROR", error.message);
    }

    throw new ApiClientError("UNKNOWN", "An unknown error occurred");
  }
}
