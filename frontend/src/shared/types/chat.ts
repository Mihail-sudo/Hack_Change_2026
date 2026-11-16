export type ChatRole = "user" | "assistant" | "system";

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
}

export interface ChatSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "completed";
  messages: ChatMessage[];
  leadId?: string;
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
