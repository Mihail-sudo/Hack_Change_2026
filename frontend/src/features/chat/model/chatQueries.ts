import { chatApi } from "@/shared/api";

export const chatKeys = {
  sessions: ["chat", "sessions"] as const,
  session: (sessionId: string) => ["chat", "session", sessionId] as const,
};

export function fetchSession(sessionId: string, signal?: AbortSignal) {
  return chatApi.getSession(sessionId, signal);
}

export function fetchSessions(signal?: AbortSignal) {
  return chatApi.listSessions(signal);
}
