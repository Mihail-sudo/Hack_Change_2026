/**
 * Интеграционные тесты ChatPage: независимые переключатели сайдбаров
 * и флаг VITE_DEBUG_PANEL_ENABLED.
 *
 * DEBUG_PANEL_ENABLED подменяется через vi.mock("@/shared/api/config").
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ChatPage } from "./ChatPage";
import { setMockFailureMode } from "@/shared/api";
import { useActiveSessionStore } from "@/features/chat";

// По умолчанию DebugPanel включён; в отдельных тестах подменяется.
vi.mock("@/shared/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/config")>();
  return {
    ...actual,
    get DEBUG_PANEL_ENABLED() {
      return mockDebugEnabled;
    },
  };
});

let mockDebugEnabled = true;

// Desktop viewport: тесты проверяют статичные панели (не drawer-режим).
// Должен совпадать с DESKTOP_BREAKPOINT в ChatPage.tsx.
const DESKTOP_BREAKPOINT = "(min-width: 1280px)";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ChatPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  mockDebugEnabled = true;
  setMockFailureMode({ mode: "never" });
  useActiveSessionStore.getState().setActiveSession(null);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatPage: переключатели сайдбаров", () => {
  it("левая панель скрывается и показывается переключателем независимо", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === DESKTOP_BREAKPOINT,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );

    const user = userEvent.setup();
    renderPage();

    const toggleLeft = await screen.findByRole("button", {
      name: "Скрыть историю диалогов",
    });
    expect(screen.getByRole("complementary", { name: "История диалогов" })).toBeInTheDocument();

    await user.click(toggleLeft);

    // Левая панель удалена из DOM
    expect(
      screen.queryByRole("complementary", { name: "История диалогов" })
    ).not.toBeInTheDocument();
    // Переключатель остался и изменил состояние
    const showLeft = screen.getByRole("button", { name: "Показать историю диалогов" });
    expect(showLeft).toHaveAttribute("aria-pressed", "false");

    // Правая панель не пострадала (независимость)
    expect(screen.getByRole("complementary", { name: "Режим отладки" })).toBeInTheDocument();

    // Восстановление
    await user.click(showLeft);
    expect(screen.getByRole("complementary", { name: "История диалогов" })).toBeInTheDocument();
  });

  it("правая панель скрывается и показывается переключателем независимо", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === DESKTOP_BREAKPOINT,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );

    const user = userEvent.setup();
    renderPage();

    const toggleRight = await screen.findByRole("button", {
      name: "Скрыть режим отладки",
    });
    expect(screen.getByRole("complementary", { name: "Режим отладки" })).toBeInTheDocument();

    await user.click(toggleRight);

    expect(screen.queryByRole("complementary", { name: "Режим отладки" })).not.toBeInTheDocument();
    const showRight = screen.getByRole("button", { name: "Показать режим отладки" });

    // Левая панель не пострадала (независимость)
    expect(screen.getByRole("complementary", { name: "История диалогов" })).toBeInTheDocument();

    await user.click(showRight);
    expect(screen.getByRole("complementary", { name: "Режим отладки" })).toBeInTheDocument();
  });

  it("VITE_DEBUG_PANEL_ENABLED=false: панель и переключатель полностью удалены из DOM", async () => {
    mockDebugEnabled = false;
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /историю диалогов/i })
      ).toBeInTheDocument()
    );

    // Панель отладки отсутствует
    expect(
      screen.queryByRole("complementary", { name: "Режим отладки" })
    ).not.toBeInTheDocument();
    // Переключатель отладки отсутствует
    expect(
      screen.queryByRole("button", { name: /режим отладки/i })
    ).not.toBeInTheDocument();
    // Чат остаётся
    expect(screen.getByText("Консультант Energytool")).toBeInTheDocument();
  });
});
