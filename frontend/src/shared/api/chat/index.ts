import type { ChatApi } from "./types";
import { createMockChatApi } from "./mock/mockChatApi";
import { createLiveChatApi } from "./live/liveChatApi";
import { createMockLeadApi } from "./mock/mockLeadApi";
import { createLiveLeadApi } from "./live/liveLeadApi";
import type { LeadApi } from "./leadApi";
import { CHAT_API_MODE } from "../config";

export type { ChatApi, SendMessageOptions } from "./types";
export type { LeadApi, SubmitLeadRequest, SubmitLeadResponse } from "./leadApi";
export { setMockFailureMode, getMockFailureMode, type MockFailureMode } from "./mock/mockFailure";

/** Точка подмены ChatApi: VITE_CHAT_API=live переключает на реальный backend. */
function getChatApi(): ChatApi {
  return CHAT_API_MODE === "live" ? createLiveChatApi() : createMockChatApi();
}

export const chatApi: ChatApi = getChatApi();

/** Точка подмены LeadApi: VITE_CHAT_API=live переключает на реальный backend. */
function getLeadApi(): LeadApi {
  return CHAT_API_MODE === "live" ? createLiveLeadApi() : createMockLeadApi();
}

export const leadApi: LeadApi = getLeadApi();
