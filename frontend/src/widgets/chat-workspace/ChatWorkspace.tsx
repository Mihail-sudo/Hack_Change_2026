import { useEffect, useRef, useState } from "react";
import { Plus, Menu, Wrench, Users, Headphones } from "lucide-react";
import { chatApi } from "@/shared/api";
import {
  MessageList,
  MessageComposer,
  QuickReplies,
  LeadDialog,
  useChatMessaging,
  useEnsureActiveSession,
  useCreateSession,
} from "@/features/chat";
import styles from "./ChatWorkspace.module.css";

interface ChatWorkspaceProps {
  onOpenHistory?: () => void;
  onOpenDebug?: () => void;
}

type HandoffState = "idle" | "pending" | "done" | "error";

export function ChatWorkspace({ onOpenHistory, onOpenDebug }: ChatWorkspaceProps) {
  const { sessionId } = useEnsureActiveSession();
  const { messages, hasPending, quickReplies, dialogMode, error, send, refetchHistory } =
    useChatMessaging(sessionId);
  const createSession = useCreateSession();
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);
  const [isLeadDialogOpen, setIsLeadDialogOpen] = useState(false);
  const [handoffState, setHandoffState] = useState<HandoffState>("idle");

  // Автопрокрутка к последнему сообщению; «мгновенно» при prefers-reduced-motion.
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const area = messagesAreaRef.current;
    if (!area) return;
    // jsdom не реализует scrollTo — используем прямое присваивание scrollTop
    area.scrollTop = area.scrollHeight;
  }, [messages.length, hasPending, prefersReducedMotion]);

  const handleNewDialog = () => {
    setLoadError(false);
    setHandoffState("idle");
    createSession.mutate(undefined, {
      onError: () => setLoadError(true),
    });
  };

  // POST /chat/handoff: постановка диалога в очередь живого оператора.
  const handleRequestOperator = async () => {
    if (!sessionId || handoffState === "pending" || dialogMode === "admin") return;
    setHandoffState("pending");
    try {
      await chatApi.requestHandoff(sessionId);
      setHandoffState("done");
    } catch {
      setHandoffState("error");
    }
  };

  const isDemo = chatApi.mode === "mock";
  const isOperatorMode = dialogMode === "admin";

  return (
    <div className={styles.chatWorkspace}>
      <header className={styles.header}>
        {onOpenHistory && (
          <button
            className={styles.navButton}
            onClick={onOpenHistory}
            aria-label="Открыть историю диалогов"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        )}

        <div className={styles.headerLeft}>
          <h1 className={styles.headerTitle}>
            Консультант Energytool
            <span className={styles.statusBadge}>
              <span className={styles.statusDot} />
              {isOperatorMode ? "Оператор" : "Онлайн"}
            </span>
            {isDemo && <span className={styles.demoBadge}>Демо</span>}
          </h1>
          <p className={styles.headerSubtitle}>Помогаю подобрать решение</p>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.headerAction}
            onClick={handleRequestOperator}
            disabled={!sessionId || hasPending || handoffState === "pending" || isOperatorMode}
            aria-label={
              isOperatorMode
                ? "Оператор подключился к диалогу"
                : handoffState === "done"
                  ? "Оператор вызван"
                  : "Позвать оператора"
            }
          >
            <Headphones size={16} aria-hidden="true" />
            <span>
              {isOperatorMode
                ? "Оператор в диалоге"
                : handoffState === "done"
                  ? "Оператор вызван"
                  : handoffState === "pending"
                    ? "Вызываем…"
                    : "Позвать оператора"}
            </span>
          </button>
          <button
            className={styles.headerAction}
            onClick={handleNewDialog}
            disabled={createSession.isPending}
            aria-label="Начать новый диалог"
          >
            <Plus size={16} aria-hidden="true" />
            <span>Новый диалог</span>
          </button>
          <button
            className={styles.headerAction}
            onClick={() => setIsLeadDialogOpen(true)}
            disabled={!sessionId || hasPending}
            aria-label="Связаться с менеджером"
          >
            <Users size={16} aria-hidden="true" />
            <span>Связаться с менеджером</span>
          </button>
          {onOpenDebug && (
            <button
              className={styles.navButton}
              onClick={onOpenDebug}
              aria-label="Открыть режим отладки"
            >
              <Wrench size={20} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <div className={styles.messagesArea} ref={messagesAreaRef}>
        {loadError ? (
          <div className={styles.loadStatus} role="alert">
            Не удалось начать новый диалог. Попробуйте ещё раз.
          </div>
        ) : error ? (
          <div className={styles.loadStatus} role="alert">
            Не удалось загрузить историю диалога.{" "}
            <button type="button" className={styles.retryBtn} onClick={refetchHistory}>
              Повторить
            </button>
          </div>
        ) : sessionId === null ? (
          <div className={styles.loadStatus} role="status">
            Подготавливаем диалог…
          </div>
        ) : messages.length === 0 ? (
          <div className={styles.loadStatus} role="status">
            Диалог пуст — напишите сообщение.
          </div>
        ) : (
          <MessageList messages={messages} onRetry={send} />
        )}
      </div>

      <div className={styles.composerArea}>
        {/* Статус вызова оператора и режима диалога */}
        {handoffState === "error" && (
          <p className={styles.operatorNotice} role="alert">
            Не удалось вызвать оператора. Попробуйте ещё раз.
          </p>
        )}
        {handoffState === "done" && !isOperatorMode && (
          <p className={styles.operatorNotice} role="status" aria-live="polite">
            Оператор вызван — ответ появится в чате.
          </p>
        )}
        {isOperatorMode && (
          <p className={styles.operatorNotice} role="status" aria-live="polite">
            Оператор подключился к диалогу.
          </p>
        )}
        {quickReplies.length > 0 && (
          <div className={styles.quickRepliesArea}>
            <QuickReplies replies={quickReplies} disabled={hasPending} onSelect={send} />
          </div>
        )}
        <MessageComposer disabled={hasPending} onSend={send} />
        <p className={styles.composerHint}>
          Демонстрационный прототип: ответы генерирует заглушка, а не реальный ИИ. Важную
          информацию проверяйте дополнительно
        </p>
      </div>

      {sessionId && (
        <LeadDialog
          isOpen={isLeadDialogOpen}
          onClose={() => setIsLeadDialogOpen(false)}
          messages={messages}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}
