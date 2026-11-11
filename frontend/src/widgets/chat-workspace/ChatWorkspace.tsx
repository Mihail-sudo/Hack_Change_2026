import { useEffect, useRef, useState } from "react";
import { Plus, Menu, Wrench } from "lucide-react";
import { chatApi } from "@/shared/api";
import {
  MessageList,
  MessageComposer,
  QuickReplies,
  useChatMessaging,
  useEnsureActiveSession,
  useCreateSession,
} from "@/features/chat";
import styles from "./ChatWorkspace.module.css";

interface ChatWorkspaceProps {
  onOpenHistory?: () => void;
  onOpenDebug?: () => void;
}

export function ChatWorkspace({ onOpenHistory, onOpenDebug }: ChatWorkspaceProps) {
  const { sessionId } = useEnsureActiveSession();
  const { messages, hasPending, quickReplies, send } = useChatMessaging(sessionId);
  const createSession = useCreateSession();
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);

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
    createSession.mutate(undefined, {
      onError: () => setLoadError(true),
    });
  };

  const isDemo = chatApi.mode === "mock";

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
              Онлайн
            </span>
            {isDemo && <span className={styles.demoBadge}>Демо</span>}
          </h1>
          <p className={styles.headerSubtitle}>Помогаю подобрать решение</p>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.headerAction}
            onClick={handleNewDialog}
            disabled={createSession.isPending}
            aria-label="Начать новый диалог"
          >
            <Plus size={16} aria-hidden="true" />
            <span>Новый диалог</span>
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
    </div>
  );
}
