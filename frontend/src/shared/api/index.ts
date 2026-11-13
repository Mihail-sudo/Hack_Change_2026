export { apiClient, ApiClientError } from "./apiClient";
export type { ApiError, ApiErrorCode, ApiResponse } from "./apiClient";
export { chatApi, leadApi } from "./chat";
export type { ChatApi, SendMessageOptions } from "./chat";
export type { LeadApi, SubmitLeadRequest, SubmitLeadResponse } from "./chat";
export { setMockFailureMode, getMockFailureMode, type MockFailureMode } from "./chat";
export { buildLeadSummary } from "./chat/leadApi";
