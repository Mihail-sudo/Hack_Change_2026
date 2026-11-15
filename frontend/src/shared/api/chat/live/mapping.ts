/**
 * Мапперы DTO backend → доменные модели (shared/types/chat.ts).
 * Поля, которых backend не отдаёт (sources, responseTimeMs, quickReplies),
 * здесь НЕ выдумываются: они остаются undefined, и UI показывает «нет данных».
 */

import type { ChatMessage, ChatSession } from "@/shared/types/chat";
import type {
  DialogReadDto,
  MessageReadDto,
  MessagesReadDto,
  LeadReadDto,
} from "./dto";

/** Префикс серверных id сообщений, чтобы не конфликтовали с локальными (user-opt-…). */
const SERVER_MESSAGE_ID_PREFIX = "srv-";

export function toDomainMessage(dto: MessageReadDto, sessionId: string): ChatMessage {
  return {
    id: `${SERVER_MESSAGE_ID_PREFIX}${dto.id}`,
    sessionId,
    role: dto.role,
    content: dto.content,
    createdAt: dto.created_at,
    status: "complete",
  };
}

/** Сессия из элемента списка диалогов (/admin/dialogs). Сообщения подгружаются отдельно. */
export function toSessionFromDialog(dto: DialogReadDto): ChatSession {
  return {
    id: dto.session_id,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    status: "active",
    messages: [],
  };
}

/** Сессия из транскрипта (/chat/{session_id}/messages). */
export function toSessionFromMessages(dto: MessagesReadDto): ChatSession {
  const messages = dto.messages.map((m) => toDomainMessage(m, dto.session_id));
  const now = new Date().toISOString();
  return {
    id: dto.session_id,
    createdAt: messages[0]?.createdAt ?? now,
    updatedAt: messages[messages.length - 1]?.createdAt ?? now,
    status: "active",
    messages,
  };
}

/** Ответ чата → доменное сообщение ассистента. responseTimeMs измеряется на frontend. */
export function toAssistantMessage(
  reply: string,
  sessionId: string,
  responseTimeMs: number
): ChatMessage {
  return {
    id: `assistant-${crypto.randomUUID()}`,
    sessionId,
    role: "assistant",
    content: reply,
    createdAt: new Date().toISOString(),
    status: "complete",
    responseTimeMs,
    // sources отсутствуют: backend (ChatResponse) их не возвращает — см. отчёт аудита.
  };
}

/** LeadReadDto → результат отправки заявки для UI. */
export function toLeadSubmissionResult(dto: LeadReadDto): { leadId: string; success: boolean } {
  return { leadId: String(dto.id), success: true };
}
