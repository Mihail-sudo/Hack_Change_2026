/**
 * Тесты DebugPanel: метаданные отладки привязаны к конкретному сообщению,
 * отсутствие данных от backend отображается как «нет данных», а не выдумывается.
 * chatApi в тестах — mock (по умолчанию), поэтому виден бейдж «демо-данные».
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DebugPanel } from "./DebugPanel";
import type { ChatMessage } from "@/shared/types/chat";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "assistant-1",
    sessionId: SESSION_ID,
    role: "assistant",
    content: "Ответ ассистента",
    createdAt: "2026-11-15T10:00:05+00:00",
    status: "complete",
    responseTimeMs: 1500,
    ...overrides,
  };
}

function renderPanel(messages: ChatMessage[]) {
  return render(<DebugPanel messages={messages} sessionId={SESSION_ID} />);
}

describe("DebugPanel", () => {
  it("показывает ID сессии и время ответа сообщения", () => {
    renderPanel([assistantMessage()]);

    expect(screen.getByText(SESSION_ID)).toBeInTheDocument();
    // responseTimeMs 1500 мс → «1.50 с» (в списке сообщений и в деталях)
    expect(screen.getAllByText("1.50 с").length).toBeGreaterThan(0);
  });

  it("без источников RAG показывает «нет данных» (backend их не возвращает)", () => {
    renderPanel([assistantMessage()]);

    expect(screen.getByText("Источники RAG")).toBeInTheDocument();
    expect(screen.getByText("нет данных")).toBeInTheDocument();
  });

  it("показывает реальные источники, когда они есть: название, score, фрагмент, страница", () => {
    renderPanel([
      assistantMessage({
        sources: [
          {
            id: "20-products/22-askue.md",
            title: "Облачная платформа АСКУЭ",
            excerpt: "Платформа для удалённого учёта электроэнергии…",
            page: 3,
            score: 0.87,
          },
        ],
      }),
    ]);

    expect(screen.getByText("Облачная платформа АСКУЭ")).toBeInTheDocument();
    expect(screen.getByText("0.87")).toBeInTheDocument();
    expect(screen.getByText("Платформа для удалённого учёта электроэнергии…")).toBeInTheDocument();
    expect(screen.getByText("стр. 3")).toBeInTheDocument();
    expect(screen.queryByText("нет данных")).not.toBeInTheDocument();
  });

  it("пустая история: подсказка отправить сообщение, без выдуманных метрик", () => {
    renderPanel([]);

    expect(screen.getByText(/Нет ответов ассистента в этой сессии/i)).toBeInTheDocument();
    expect(screen.queryByText("1.50 с")).not.toBeInTheDocument();
  });

  it("сообщение без responseTimeMs отображает «—», а не ноль", () => {
    renderPanel([assistantMessage({ responseTimeMs: undefined })]);

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
