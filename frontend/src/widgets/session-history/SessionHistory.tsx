import { useState } from "react";
import { Zap, Plus, X, AlertCircle, Activity, MessageSquare, User, Bot, ChevronDown } from "lucide-react";
import type { ChatSession } from "@/shared/types/chat";
import {
  useChatSessions,
  useCreateSession,
  useActiveSessionStore,
  useChatSession,
} from "@/features/chat";
import styles from "./SessionHistory.module.css";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Заголовок сессии: сохранённый title (первая реплика пользователя) либо дата. */
function sessionTitle(
  session: { title?: string; messages: ChatSession["messages"]; createdAt: string }
): string {
  const saved = session.title?.trim();
  if (saved)
    return saved.length < session.title!.trim().length ? `${saved}…` : saved;
  const firstUserMessage = session.messages.find((m) => m.role === "user")?.content;
  if (firstUserMessage) {
    const snippet = firstUserMessage.trim().slice(0, 40);
    return snippet.length < firstUserMessage.trim().length ? `${snippet}…` : snippet;
  }
  return `Диалог от ${formatDate(session.createdAt)}`;
}

interface SessionHistoryProps {
  /** Renders a close button when provided (drawer mode on tablet / mobile). */
  onClose?: () => void;
}

/** Компонент "Моя активность" — локальные метрики пользователя. */
function MyActivityStats() {
  const activeSessionId = useActiveSessionStore((s) => s.activeSessionId);
  const { data: activeSession } = useChatSession(activeSessionId);
  const sessionsQuery = useChatSessions();

  const sessions = sessionsQuery.data ?? [];
  const messages = activeSession?.messages ?? [];

  const totalSessions = sessions.length;
  const totalMessages = messages.length;
  const userMessages = messages.filter((m) => m.role === "user").length;
  const assistantMessages = messages.filter((m) => m.role === "assistant").length;

  return (
    <div className={styles.activityPanel}>
      <p className={styles.activityDescription}>
        Метрики рассчитаны на основе данных этого браузера.
      </p>

      <div className={styles.activityGrid}>
        <div className={styles.activityMetric}>
          <span className={styles.activityValue}>{totalSessions}</span>
          <span className={styles.activityLabel}>
            <MessageSquare size={12} aria-hidden="true" />
            Всего диалогов
          </span>
        </div>

        <div className={styles.activityMetric}>
          <span className={styles.activityValue}>{totalMessages}</span>
          <span className={styles.activityLabel}>
            <MessageSquare size={12} aria-hidden="true" />
            Сообщений
          </span>
        </div>

        <div className={styles.activityMetric}>
          <span className={styles.activityValue}>{userMessages}</span>
          <span className={styles.activityLabel}>
            <User size={12} aria-hidden="true" />
            Ваших
          </span>
        </div>

        <div className={styles.activityMetric}>
          <span className={styles.activityValue}>{assistantMessages}</span>
          <span className={styles.activityLabel}>
            <Bot size={12} aria-hidden="true" />
            Ответов
          </span>
        </div>
      </div>
    </div>
  );
}

export function SessionHistory({ onClose }: SessionHistoryProps) {
  const sessionsQuery = useChatSessions();
  const activeSessionId = useActiveSessionStore((s) => s.activeSessionId);
  const setActiveSession = useActiveSessionStore((s) => s.setActiveSession);
  const createSession = useCreateSession();

  const [isActivityOpen, setIsActivityOpen] = useState(false);

  const sessions = sessionsQuery.data ?? [];

  const handleNewDialog = () => {
    createSession.mutate(undefined, {
      onSuccess: () => onClose?.(),
    });
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSession(sessionId);
    onClose?.();
  };

  const handleActivityToggle = () => {
    setIsActivityOpen((v) => !v);
  };

  return (
    <div className={styles.sessionHistory}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <Zap />
        </div>
        <div className={styles.logoText}>
          <span className={styles.logoTitle}>МТС ENERGYTOOL</span>
          <span className={styles.logoSubtitle}>ИИ-консультант</span>
        </div>
        {onClose && (
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Закрыть историю диалогов"
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <button
        className={styles.newDialogBtn}
        onClick={handleNewDialog}
        disabled={createSession.isPending}
      >
        <Plus size={16} aria-hidden="true" />
        Новый диалог
      </button>

      <h3 className={styles.sectionTitle}>История диалогов</h3>

      <div className={styles.sessionList} role="list" aria-label="Список диалогов">
        {sessionsQuery.isLoading && (
          <div className={styles.listStatus} role="status">
            Загрузка истории…
          </div>
        )}
        {sessionsQuery.isError && (
          <div className={styles.listStatus} role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            Не удалось загрузить историю.
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => sessionsQuery.refetch()}
            >
              Повторить
            </button>
          </div>
        )}
        {sessionsQuery.isSuccess && sessions.length === 0 && (
          <div className={styles.listStatus}>История пока пуста.</div>
        )}
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            role="listitem"
            className={`${styles.sessionItem} ${session.id === activeSessionId ? styles.sessionItemActive : ""}`}
            onClick={() => handleSelectSession(session.id)}
            aria-current={session.id === activeSessionId ? "true" : undefined}
            aria-label={`Диалог: ${sessionTitle(session)}`}
          >
            <span className={styles.sessionTitle}>{sessionTitle(session)}</span>
            <span className={styles.sessionDate}>{formatDate(session.updatedAt)}</span>
          </button>
        ))}
      </div>

      <div className={styles.footer}>
        {/* Моя активность */}
        <div className={styles.footerSection}>
          <button
            className={`${styles.footerItem} ${isActivityOpen ? styles.footerItemActive : ""}`}
            onClick={handleActivityToggle}
            aria-expanded={isActivityOpen}
            aria-controls="activity-panel"
          >
            <Activity size={18} aria-hidden="true" />
            <span>Моя активность</span>
            <ChevronDown
              size={14}
              className={`${styles.chevron} ${isActivityOpen ? styles.chevronOpen : ""}`}
              aria-hidden="true"
            />
          </button>

          {isActivityOpen && (
            <div id="activity-panel" className={styles.activityContainer}>
              <MyActivityStats />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
