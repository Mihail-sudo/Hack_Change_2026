import type { ChatApi } from "./types";
import { createMockChatApi } from "./mock/mockChatApi";
import { createLiveChatApi } from "./live/liveChatApi";
import { createMockLeadApi } from "./mock/mockLeadApi";
import { createLiveLeadApi } from "./live/liveLeadApi";
import type { LeadApi } from "./leadApi";

export type { ChatApi, SendMessageOptions } from "./types";
export type { LeadApi, SubmitLeadRequest, SubmitLeadResponse } from "./leadApi";
export { setMockFailureMode, getMockFailureMode, type MockFailureMode } from "./mock/mockFailure";

/** Точка подмены ChatApi: VITE_CHAT_API=live переключит на реальный backend. */
function getChatApi(): ChatApi {
  return import.meta.env.VITE_CHAT_API === "live" ? createLiveChatApi() : createMockChatApi();
}

export const chatApi: ChatApi = getChatApi();

/** Точка подмены LeadApi: VITE_CHAT_API=live переключит на реальный backend. */
function getLeadApi(): LeadApi {
  return import.meta.env.VITE_CHAT_API === "live" ? createLiveLeadApi() : createMockLeadApi();
}

export const leadApi: LeadApi = getLeadApi();
