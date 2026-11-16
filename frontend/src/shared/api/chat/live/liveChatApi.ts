import { apiClient } from "@/shared/api/apiClient";
import type { ChatMessage, ChatSession, SendMessageResponse } from "@/shared/types/chat";
import type { ChatApi, SendMessageOptions } from "../types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

type BackendMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type MessagesResponse = {
  session_id: string;
  mode: "bot" | "admin";
  messages: BackendMessage[];
};

type DialogListResponse = {
  dialogs: Array<{
    session_id: string;
    created_at: string;
    updated_at: string;
    last_message: string | null;
  }>;
};

function toChatMessage(message: BackendMessage, sessionId: string): ChatMessage {
  return {
    id: String(message.id),
    sessionId,
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
    status: "complete",
  };
}

function sessionFromMessages(sessionId: string, payload: MessagesResponse): ChatSession {
  const messages = payload.messages.map((message) => toChatMessage(message, sessionId));
  const createdAt = messages[0]?.createdAt ?? new Date().toISOString();
  return {
    id: sessionId,
    createdAt,
    updatedAt: messages.at(-1)?.createdAt ?? createdAt,
    status: "active",
    messages,
  };
}

export function createLiveChatApi(): ChatApi {
  return {
    mode: "live",

    async createSession(initialMessages: ChatMessage[] = [], signal?: AbortSignal): Promise<ChatSession> {
      if (signal?.aborted) throw new DOMException("Запрос отменён", "AbortError");
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const messages = initialMessages.length > 0 ? initialMessages : [{
        id: `greeting-${id}`,
        sessionId: id,
        role: "assistant" as const,
        content: "Здравствуйте! Я помогу разобраться с расходами на электроэнергию, учётом и решениями Energytool. Расскажите, какая задача у вас возникла.",
        createdAt: now,
        status: "complete" as const,
      }];
      return { id, createdAt: now, updatedAt: now, status: "active", messages };
    },

    async listSessions(signal?: AbortSignal): Promise<ChatSession[]> {
      const payload = await apiClient<DialogListResponse>(`${API_BASE}/admin/dialogs`, { signal });
      return Promise.all(payload.dialogs.map(async (dialog) => {
        const messages = await apiClient<MessagesResponse>(`${API_BASE}/chat/${dialog.session_id}/messages`, { signal });
        return sessionFromMessages(dialog.session_id, messages);
      }));
    },

    async getSession(sessionId: string, signal?: AbortSignal): Promise<ChatSession> {
      const payload = await apiClient<MessagesResponse>(`${API_BASE}/chat/${sessionId}/messages`, { signal });
      return sessionFromMessages(sessionId, payload);
    },

    async sendMessage(request: SendMessageOptions): Promise<SendMessageResponse> {
      const started = Date.now();
      const response = await apiClient<{
        reply: string;
        done: boolean;
        fallback: boolean;
        mode: "bot" | "admin";
      }>(`${API_BASE}/chat`, {
        method: "POST",
        body: JSON.stringify({ session_id: request.sessionId, message: request.content }),
        signal: request.signal,
      });
      const now = new Date().toISOString();
      const message: ChatMessage = {
        id: `assistant-${crypto.randomUUID()}`,
        sessionId: request.sessionId,
        role: "assistant",
        content: response.reply,
        createdAt: now,
        status: "complete",
        responseTimeMs: Date.now() - started,
      };
      return { message, sessionId: request.sessionId };
    },
  };
}
