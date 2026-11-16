/**
 * DTO backend (FastAPI) — источник истины: http://localhost:8000/openapi.json
 * и backend/app/schemas.py. Снек-кейс сознательно сохранён: это транспортный слой,
 * в доменные модели (shared/types/chat.ts) данные переводят мапперы из mapping.ts.
 *
 * Backend не предоставляет: sources RAG, responseTimeMs, quickReplies, lead payload
 * с полями need/solutions/openQuestions — соответствующие места помечены.
 *
 * GET /admin/dialogs НЕ используется в публичном виджете: без авторизации он
 * возвращает диалоги всех пользователей (см. liveChatApi.listSessions).
 */

/** Шаблон session_id: ^[A-Za-z0-9_-]{8,128}$ (crypto.randomUUID подходит). */

// POST /chat
export interface ChatRequestDto {
  session_id: string;
  message: string;
}

export type DialogModeDto = "bot" | "admin";

// POST /chat → 200
export interface ChatResponseDto {
  reply: string;
  done: boolean;
  /** true — агент упал, показан запасной ответ. */
  fallback: boolean;
  mode: DialogModeDto;
}

// POST /chat/handoff → 200 (запрос живого оператора)
export interface HandoffRequestDto {
  session_id: string;
}

export interface HandoffResponseDto {
  ok: boolean;
}

// GET /chat/{session_id}/messages
export type MessageRoleDto = "user" | "assistant";
export type MessageAuthorDto = "client" | "bot" | "admin";

export interface MessageReadDto {
  id: number;
  role: MessageRoleDto;
  author: MessageAuthorDto;
  content: string;
  created_at: string;
}

export interface MessagesReadDto {
  session_id: string;
  mode: DialogModeDto;
  messages: MessageReadDto[];
}

// POST /leads → 201
export type ContactTypeDto = "email" | "phone" | "telegram" | "other";

export interface LeadCreateDto {
  /** Описание задачи; включает company/sessionId/summary, т.к. отдельных полей нет. */
  question: string;
  name?: string | null;
  contact: string;
  contact_type: ContactTypeDto;
}

export interface LeadReadDto {
  id: number;
  status: "new" | "delivered" | "failed";
  created_at: string;
}
