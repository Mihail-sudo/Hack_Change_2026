import type { ChatSession } from "@/shared/types/chat";

/**
 * In-memory хранилище сессий mock-сервиса. Живёт только в пределах вкладки.
 * При подключении реального backend удаляется вместе с mock-слоем.
 */

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function seedSession(createdAt: string): ChatSession {
  return {
    id: createId(),
    createdAt,
    updatedAt: createdAt,
    status: "completed",
    messages: [],
  };
}

export class MockChatStore {
  private sessions = new Map<string, ChatSession>();

  constructor(seed: ChatSession[] = []) {
    // Пара «исторических» сессий без сообщений — только чтобы список истории не был пуст.
    const seeded =
      seed.length > 0
        ? seed
        : [
            seedSession(new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString()),
            seedSession(new Date(Date.now() - 1000 * 60 * 60 * 74).toISOString()),
          ];
    for (const session of seeded) {
      this.sessions.set(session.id, { ...session, messages: [...session.messages] });
    }
  }

  createSession(initialMessages: ChatSession["messages"]): ChatSession {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: createId(),
      createdAt: now,
      updatedAt: now,
      status: "active",
      messages: [...initialMessages],
    };
    this.sessions.set(session.id, session);
    return this.clone(session);
  }

  get(sessionId: string): ChatSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.clone(session) : undefined;
  }

  list(): ChatSession[] {
    return Array.from(this.sessions.values())
      .map((s) => this.clone(s))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  appendMessages(sessionId: string, messages: ChatMessageLike[]): ChatSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.messages.push(...messages);
    session.updatedAt = new Date().toISOString();
    return this.clone(session);
  }

  /** Очищает хранилище — только для тестов. */
  reset(seed: ChatSession[] = []): void {
    this.sessions.clear();
    for (const session of seed) {
      this.sessions.set(session.id, { ...session, messages: [...session.messages] });
    }
  }

  private clone(session: ChatSession): ChatSession {
    return { ...session, messages: session.messages.map((m) => ({ ...m })) };
  }
}

export type ChatMessageLike = ChatSession["messages"][number];
