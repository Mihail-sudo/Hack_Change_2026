export type ChatRole = "user" | "assistant" | "system";

/** Режим диалога на backend (DialogModeDto): "bot" — агент, "admin" — оператор. */
export type DialogMode = "bot" | "admin";

/** Автор сообщения на backend (MessageAuthorDto). */
export type MessageAuthor = "client" | "bot" | "admin";

export interface KnowledgeSource {
  id: string;
  title: string;
  excerpt?: string;
  page?: number;
  score?: number;
  url?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  sources?: KnowledgeSource[];
  responseTimeMs?: number;
  status?: "pending" | "complete" | "error";
  /**
   * Предлагаемые быстрые ответы, приходящие вместе с ответом ассистента.
   * Концептуальное поле контракта — сверить с backend-командой.
   */
  quickReplies?: string[];
  /**
   * Автор сообщения на backend ("client" | "bot" | "admin").
   * Заполняется только для сообщений, загруженных с сервера; "admin" — реплика оператора.
   */
  author?: MessageAuthor;
  /** Числовой id сообщения в БД backend (для дедупликации и курсора after_id). */
  serverId?: number;
  /** true — агент упал, backend вернул запасной ответ (ChatResponse.fallback). */
  fallback?: boolean;
}

export interface ChatSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "completed";
  messages: ChatMessage[];
  leadId?: string;
  /** Заголовок для списка сессий (первая реплика пользователя), если известен. */
  title?: string;
}

export interface LeadInput {
  fullName: string;
  phone: string;
  companyName: string;
}

export interface LeadSubmission extends LeadInput {
  sessionId: string;
  summary: string;
}

// API Response types
export interface SendMessageRequest {
  sessionId: string;
  content: string;
}

export interface SendMessageResponse {
  message: ChatMessage;
  sessionId: string;
}

export interface CreateSessionResponse {
  session: ChatSession;
}

export interface SubmitLeadRequest {
  fullName: string;
  phone: string;
  companyName: string;
  sessionId: string;
  summary: string;
}

export interface SubmitLeadResponse {
  leadId: string;
  success: boolean;
}
