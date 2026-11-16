/**
 * Мапперы DTO backend → доменные модели (shared/types/chat.ts).
 * Поля, которых backend не отдаёт (sources, responseTimeMs, quickReplies),
 * здесь НЕ выдумываются: они остаются undefined, и UI показывает «нет данных».
 */

import type { ChatMessage, ChatSession } from "@/shared/types/chat";
import type { MessageReadDto, MessagesReadDto, LeadReadDto } from "./dto";

/** Префикс серверных id сообщений, чтобы не конфликтовали с локальными (user-opt-…). */
const SERVER_MESSAGE_ID_PREFIX = "srv-";

export function toDomainMessage(dto: MessageReadDto, sessionId: string): ChatMessage {
  return {
    id: `${SERVER_MESSAGE_ID_PREFIX}${dto.id}`,
    serverId: dto.id,
    sessionId,
    role: dto.role,
    author: dto.author,
    content: dto.content,
    createdAt: dto.created_at,
    status: "complete",
  };
}

/** Сессия из транскрипта (GET /chat/{session_id}/messages). */
export function toSessionFromMessages(dto: MessagesReadDto): ChatSession {
  const messages = dto.messages.map((m) => toDomainMessage(m, dto.session_id));
  const now = new Date().toISOString();
  const firstUserMessage = messages.find((m) => m.role === "user")?.content.trim();
  return {
    id: dto.session_id,
    createdAt: messages[0]?.createdAt ?? now,
    updatedAt: messages[messages.length - 1]?.createdAt ?? now,
    status: "active",
    messages,
    title: firstUserMessage ? firstUserMessage.slice(0, 80) : undefined,
  };
}

/**
 * Ответ чата → доменное сообщение ассистента.
 * responseTimeMs измеряется на frontend (backend его не присылает).
 * fallback — реальный признак ChatResponse (агент упал, показан запасной ответ).
 */
export function toAssistantMessage(
  reply: string,
  sessionId: string,
  responseTimeMs: number,
  fallback = false
): ChatMessage {
  return {
    id: `assistant-${crypto.randomUUID()}`,
    sessionId,
    role: "assistant",
    author: "bot",
    content: reply,
    createdAt: new Date().toISOString(),
    status: "complete",
    responseTimeMs,
    fallback,
    // sources отсутствуют: backend (ChatResponse) их не возвращает — см. отчёт аудита.
  };
}

/** LeadReadDto → результат отправки заявки для UI. */
export function toLeadSubmissionResult(dto: LeadReadDto): { leadId: string; success: boolean } {
  return { leadId: String(dto.id), success: true };
}
