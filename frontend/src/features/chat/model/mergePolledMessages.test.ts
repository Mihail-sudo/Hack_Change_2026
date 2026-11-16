/**
 * Unit-тесты mergePolledMessages — слияние сообщений поллинга с отображёнными.
 * Правила: свои реплики (author=client) не дублируются, дедуп по serverId,
 * ответ из POST /chat не дублируется серверной копией из поллинга.
 */

import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@/shared/types/chat";
import { mergePolledMessages } from "./mergePolledMessages";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function serverMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "srv-12",
    serverId: 12,
    sessionId: SESSION_ID,
    role: "assistant",
    author: "admin",
    content: "Здравствуйте, я оператор",
    createdAt: "2026-11-15T10:00:20+00:00",
    status: "complete",
    ...overrides,
  };
}

describe("mergePolledMessages", () => {
  it("добавляет новую реплику оператора", () => {
    const existing: ChatMessage[] = [
      {
        id: "user-opt-1",
        sessionId: SESSION_ID,
        role: "user",
        content: "Позовите оператора",
        createdAt: "2026-11-15T10:00:00+00:00",
        status: "complete",
      },
    ];

    const merged = mergePolledMessages(existing, [serverMessage()]);

    expect(merged).toHaveLength(2);
    expect(merged[1]!.id).toBe("srv-12");
    expect(merged[1]!.author).toBe("admin");
  });

  it("пропускает собственные реплики пользователя (author=client) — они уже показаны", () => {
    const merged = mergePolledMessages([], [
      serverMessage({ id: "srv-11", serverId: 11, role: "user", author: "client", content: "Привет" }),
    ]);

    expect(merged).toEqual([]);
  });

  it("не дублирует сообщение, уже загруженное транскриптом (совпадение serverId)", () => {
    const existing = [serverMessage()];
    const merged = mergePolledMessages(existing, [serverMessage()]);

    expect(merged).toHaveLength(1);
  });

  it("не дублирует ответ ассистента, уже добавленный из ответа POST /chat (совпадение текста, у локального нет serverId)", () => {
    const existing: ChatMessage[] = [
      {
        id: "assistant-uuid-1",
        sessionId: SESSION_ID,
        role: "assistant",
        content: "Бот: используйте АСКУЭ",
        createdAt: "2026-11-15T10:00:05+00:00",
        status: "complete",
      },
    ];

    const merged = mergePolledMessages(existing, [
      serverMessage({ author: "bot", content: "Бот: используйте АСКУЭ" }),
    ]);

    expect(merged).toHaveLength(1);
  });

  it("повтор операторской реплики с тем же текстом НЕ теряется (обе уже с serverId)", () => {
    const existing = [
      serverMessage({ id: "srv-20", serverId: 20, content: "Проверяю ваш счётчик" }),
    ];

    const merged = mergePolledMessages(existing, [
      serverMessage({ id: "srv-25", serverId: 25, content: "Проверяю ваш счётчик" }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it("не мутирует входной массив", () => {
    const existing: ChatMessage[] = [];
    const merged = mergePolledMessages(existing, [serverMessage()]);

    expect(existing).toHaveLength(0);
    expect(merged).toHaveLength(1);
  });
});
