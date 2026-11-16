import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { chatApi } from "@/shared/api";
import type { ChatSession, DialogMode } from "@/shared/types/chat";
import { chatKeys } from "./chatQueries";
import { mergePolledMessages } from "./mergePolledMessages";

const DEFAULT_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MULTIPLIER = 12; // интервал растёт до ~60 с при ошибках сети

export interface OperatorPollingOptions {
  /** Базовый интервал опроса, мс (для тестов можно уменьшить). */
  intervalMs?: number;
}

/**
 * Поллинг новых сообщений активной сессии (реплики оператора, режим "admin").
 *
 * Реализован на реальном endpoint backend: GET /chat/{session_id}/messages?after_id=N
 * (MessageRead.author различает client/bot/admin).
 *
 * Гарантии:
 * - опрашивается ТОЛЬКО активная сессия; при смене сессии курсор сбрасывается,
 *   in-flight запрос прерывается (AbortSignal) и больше не может повлиять ни на
 *   новое состояние, ни на кэш старой сессии;
 * - курсор after_id — максимальный числовой id из БД backend; собственные
 *   реплики пользователя не отображаются повторно, но продвигают курсор;
 * - дедупликация: см. mergePolledMessages;
 * - при унмаунте таймер останавливается, запрос прерывается;
 * - сетевые ошибки не роняют UI: опрос продолжается с экспоненциальной
 *   задержкой (до ~60 с), успех сбрасывает задержку;
 * - зависший запрос прошлой сессии не блокирует поллинг новой
 *   (генерация опроса инвалидируется при смене сессии).
 */
export function useOperatorPolling(
  sessionId: string | null,
  options: OperatorPollingOptions = {}
): { dialogMode: DialogMode; pollNow: () => void } {
  const { intervalMs = DEFAULT_INTERVAL_MS } = options;
  const queryClient = useQueryClient();
  // Режим хранится вместе с id сессии: при смене сессии значение выводится
  // во время рендера (без setState в эффекте), а не мутируется синхронно.
  const [modeState, setModeState] = useState<{
    sessionId: string | null;
    mode: DialogMode;
  }>({ sessionId: null, mode: "bot" });
  const dialogMode: DialogMode = modeState.sessionId === sessionId ? modeState.mode : "bot";

  const cursorRef = useRef(0);
  const failuresRef = useRef(0);
  const pollingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(sessionId);
  const abortRef = useRef<AbortController | null>(null);
  const tickRef = useRef<(() => void) | null>(null);
  /** Инвалидация in-flight опроса при смене сессии/унмаунте. */
  const generationRef = useRef(0);

  const poll = useCallback(async (): Promise<void> => {
    const currentSessionId = sessionIdRef.current;
    const generation = generationRef.current;
    if (!currentSessionId || pollingRef.current) return;
    pollingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await chatApi.listNewMessages(
        currentSessionId,
        cursorRef.current,
        controller.signal
      );
      // Сессия сменилась, опрос инвалидирован или отменён — результат игнорируем.
      if (
        generationRef.current !== generation ||
        sessionIdRef.current !== currentSessionId ||
        controller.signal.aborted
      ) {
        return;
      }

      cursorRef.current = result.lastId;
      failuresRef.current = 0;
      setModeState({ sessionId: currentSessionId, mode: result.mode });

      if (result.messages.length > 0) {
        queryClient.setQueryData<ChatSession>(
          chatKeys.session(currentSessionId),
          (previous) => {
            if (!previous) return previous;
            const messages = mergePolledMessages(previous.messages, result.messages);
            if (messages === previous.messages) return previous;
            return {
              ...previous,
              messages,
              updatedAt: messages[messages.length - 1]?.createdAt ?? previous.updatedAt,
            };
          }
        );
      }
    } catch {
      // Ошибки сети/сервера не прерывают поллинг — задержка растёт в scheduleNext.
      if (!controller.signal.aborted && generationRef.current === generation) {
        failuresRef.current += 1;
      }
    } finally {
      // Сбрасываем семафор только если это по-прежнему актуальный опрос.
      if (generationRef.current === generation) {
        pollingRef.current = false;
        abortRef.current = null;
      }
    }
  }, [queryClient]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    cursorRef.current = 0;
    failuresRef.current = 0;
    generationRef.current += 1;
    pollingRef.current = false;
    abortRef.current?.abort();

    if (sessionId === null) {
      tickRef.current = null;
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (timer !== null) clearTimeout(timer);
      const multiplier = Math.min(2 ** failuresRef.current, MAX_BACKOFF_MULTIPLIER);
      timer = setTimeout(tick, intervalMs * multiplier);
    };

    const tick = () => {
      if (cancelled) return;
      void poll().finally(() => {
        if (!cancelled) scheduleNext();
      });
    };

    tickRef.current = tick;
    // Первый тик сразу: синхронизирует курсор с уже загруженной историей.
    void tick();

    return () => {
      cancelled = true;
      tickRef.current = null;
      if (timer !== null) clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [sessionId, intervalMs, poll]);

  // Немедленный опрос (например, сразу после успешной отправки сообщения) —
  // синхронизирует курсор, чтобы следующий интервал не вернул дубликаты.
  const pollNow = useCallback(() => {
    tickRef.current?.();
  }, []);

  return { dialogMode, pollNow };
}
