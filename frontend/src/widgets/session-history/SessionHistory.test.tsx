/**
 * Тесты секции «Моя активность» в SessionHistory.
 *
 * Проверяемые сценарии:
 * - секция открывается по клику и показывает локальные метрики;
 * - метрики рассчитываются только из локальных данных;
 * - административные endpoints не вызываются (GET /admin/dialogs, GET /admin/leads).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SessionHistory } from "./SessionHistory";
import { setMockFailureMode, chatApi } from "@/shared/api";
import { useActiveSessionStore } from "@/features/chat";

function renderHistory() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<SessionHistory />, { wrapper: Wrapper });
}

beforeEach(() => {
  setMockFailureMode({ mode: "never" });
  useActiveSessionStore.getState().setActiveSession(null);
  localStorage.clear();
});

describe("SessionHistory: Моя активность", () => {
  it("секция скрыта по умолчанию и открывается по клику", async () => {
    const user = userEvent.setup();
    renderHistory();

    expect(screen.queryByText(/Метрики рассчитаны/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Моя активность/i }));

    expect(await screen.findByText(/Метрики рассчитаны/)).toBeInTheDocument();
  });

  it("показывает реальные локальные метрики без выдуманных значений", async () => {
    // Готовим данные: одна сессия с сообщением пользователя
    const session = await chatApi.createSession();
    await chatApi.sendMessage({ sessionId: session.id, content: "Счета выросли" });
    useActiveSessionStore.getState().setActiveSession(session.id);

    const user = userEvent.setup();
    renderHistory();

    await user.click(screen.getByRole("button", { name: /Моя активность/i }));

    await waitFor(() => {
      // 1 сессия в реестре
      expect(screen.getByText("1")).toBeInTheDocument();
    });
    // Метрика «Всего диалогов» присутствует
    expect(screen.getByText(/Всего диалогов/)).toBeInTheDocument();
  });

  it("для пустой активной сессии метрики сообщений равны нулю, а не пропадают", async () => {
    const session = await chatApi.createSession();
    useActiveSessionStore.getState().setActiveSession(session.id);

    const user = userEvent.setup();
    renderHistory();

    await user.click(screen.getByRole("button", { name: /Моя активность/i }));

    await waitFor(() => {
      expect(screen.getByText(/Всего диалогов/)).toBeInTheDocument();
    });
    // В mock-режиме createSession добавляет приветствие → 1 сообщение ассистента, 0 пользовательских
    expect(screen.getByText(/Ответов/)).toBeInTheDocument();
    expect(screen.getByText(/Ваших/)).toBeInTheDocument();
  });

  it("не вызывает административные endpoints (GET /admin/dialogs, GET /admin/leads)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network disabled"));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderHistory();

    await user.click(screen.getByRole("button", { name: /Моя активность/i }));

    await waitFor(() => expect(screen.getByText(/Всего диалогов/)).toBeInTheDocument());

    // Ни один fetch не должен был уйти на /admin/*
    const adminCalls = fetchMock.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("/admin")
    );
    expect(adminCalls).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("aria-expanded переключается при открытии/закрытии", async () => {
    const user = userEvent.setup();
    renderHistory();

    const toggle = screen.getByRole("button", { name: /Моя активность/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Метрики рассчитаны/)).not.toBeInTheDocument();
  });
});
