import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ChatWorkspace } from "./ChatWorkspace";
import { setMockFailureMode } from "@/shared/api";
import { useActiveSessionStore } from "@/features/chat";

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ChatWorkspace />, { wrapper: Wrapper });
}

const SHOP_MESSAGE =
  "У нас небольшой магазин, счета за электричество сильно выросли. Хотим снизить расходы";

beforeEach(() => {
  setMockFailureMode({ mode: "never" });
  useActiveSessionStore.getState().setActiveSession(null);
});

describe("ChatWorkspace — пользовательский сценарий чата", () => {
  it("начальный сценарий: приветствие → сообщение пользователя справа → ответ со быстрыми ответами", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    // 1. Приветствие ассистента
    await waitFor(
      () => expect(screen.getByText(/Здравствуйте! Я помогу разобраться/)).toBeInTheDocument(),
      { timeout: 4000 }
    );

    // 2. Пользователь отправляет сообщение
    const textarea = screen.getByLabelText("Поле ввода сообщения");
    await user.type(textarea, SHOP_MESSAGE);
    await user.click(screen.getByLabelText("Отправить сообщение"));

    // 3. Сообщение пользователя появилось
    expect(await screen.findByText(SHOP_MESSAGE, undefined, { timeout: 4000 })).toBeInTheDocument();

    // 4. Состояние ожидания ответа
    expect(screen.getByRole("status", { name: "Консультант готовит ответ" })).toBeInTheDocument();

    // 5. Ответ ассистента
    expect(
      await screen.findByText(/Подскажите, пожалуйста, у вас есть почасовые данные/i, undefined, {
        timeout: 4000,
      })
    ).toBeInTheDocument();

    // 6. Быстрые ответы
    expect(screen.getByRole("button", { name: "Есть почасовые данные потребления." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Только общий счёт за месяц." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Не знаю." })).toBeInTheDocument();
  });

  it("быстрый ответ отправляется и получает ветку сценария", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.type(screen.getByLabelText("Поле ввода сообщения"), SHOP_MESSAGE);
    await user.click(screen.getByLabelText("Отправить сообщение"));

    const hourlyReply = await screen.findByRole(
      "button",
      { name: "Есть почасовые данные потребления." },
      { timeout: 4000 }
    );
    await user.click(hourlyReply);

    expect(
      await screen.findByText(/у вас есть почасовые данные потребления/i, undefined, {
        timeout: 4000,
      })
    ).toBeInTheDocument();
  });

  it("повторная отправка блокируется во время ожидания ответа", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.type(screen.getByLabelText("Поле ввода сообщения"), SHOP_MESSAGE);
    await user.click(screen.getByLabelText("Отправить сообщение"));

    // Кнопка отправки заблокирована на время генерации ответа
    const sendButton = screen.getByRole("button", { name: "Ассистент отвечает" });
    expect(sendButton).toBeDisabled();

    await screen.findByText(/Подскажите, пожалуйста/i, undefined, { timeout: 4000 });

    // После ответа кнопка снова доступна (как только введён текст)
    expect(screen.getByRole("button", { name: "Отправить сообщение" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Поле ввода сообщения"), "x");
    expect(screen.getByRole("button", { name: "Отправить сообщение" })).toBeEnabled();
  });

  it("ошибка отправки: сообщение об ошибке и повтор, введённые данные не теряются", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() => screen.getByText(/Здравствуйте!/i), { timeout: 4000 });

    setMockFailureMode({ mode: "once" });
    await user.type(screen.getByLabelText("Поле ввода сообщения"), "Тестовое сообщение");
    await user.click(screen.getByLabelText("Отправить сообщение"));

    // Ошибка видна, сообщение пользователя осталось, есть кнопка повтора
    expect(await screen.findByRole("alert", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("Тестовое сообщение")).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "Повторить отправку сообщения" });
    expect(retryButton).toBeInTheDocument();

    // Повтор успешен
    await user.click(retryButton);
    await waitFor(
      () => {
        expect(
          screen.queryByRole("button", { name: "Повторить отправку сообщения" })
        ).not.toBeInTheDocument();
      },
      { timeout: 4000 }
    );
    expect(screen.getByText("Тестовое сообщение")).toBeInTheDocument();
  });

  it("длинное сообщение отображается полностью (без обрезки)", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() => screen.getByText(/Здравствуйте!/i), { timeout: 4000 });

    const longWord = "оченьдлинныйтекстбезпереносов".repeat(30);
    const textarea = screen.getByLabelText("Поле ввода сообщения");
    await user.click(textarea);
    // Вставка вместо посимвольного ввода — быстро и близко к реальному сценарию
    fireEvent.change(textarea, { target: { value: longWord } });

    expect((textarea as HTMLTextAreaElement).value).toBe(longWord);
    const sendButton = screen.getByRole("button", { name: "Отправить сообщение" });
    expect(sendButton).toBeEnabled();
    await user.click(sendButton);

    const bubble = await screen.findByText(new RegExp(longWord), undefined, { timeout: 4000 });
    expect(bubble.textContent).toBe(longWord);
  }, 20000);
});
