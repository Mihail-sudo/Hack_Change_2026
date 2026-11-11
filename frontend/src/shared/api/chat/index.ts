import type { ChatApi } from "./types";
import { createMockChatApi } from "./mock/mockChatApi";
import { createLiveChatApi } from "./live/liveChatApi";

export type { ChatApi, SendMessageOptions } from "./types";
export { setMockFailureMode, getMockFailureMode, type MockFailureMode } from "./mock/mockFailure";

/**
 * Точка подмены реализации: компоненты знают только про интерфейс ChatApi.
 * VITE_CHAT_API=live переключит на реальный backend, когда он появится.
 */
function getChatApi(): ChatApi {
  return import.meta.env.VITE_CHAT_API === "live" ? createLiveChatApi() : createMockChatApi();
}

export const chatApi: ChatApi = getChatApi();
