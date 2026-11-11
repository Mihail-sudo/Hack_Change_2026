export { apiClient, ApiClientError } from "./apiClient";
export type { ApiError, ApiErrorCode, ApiResponse } from "./apiClient";
export { chatApi } from "./chat";
export type { ChatApi, SendMessageOptions } from "./chat";
export { setMockFailureMode, getMockFailureMode, type MockFailureMode } from "./chat";
