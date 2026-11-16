import { Zap, Plus, BarChart3, X, AlertCircle } from "lucide-react";
import {
  useChatSessions,
  useCreateSession,
  useActiveSessionStore,
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

/** Заголовок сессии: фрагмент первого сообщения пользователя либо дата. */
function sessionTitle(firstUserMessage: string | undefined, createdAt: string): string {
  if (firstUserMessage) {
    const snippet = firstUserMessage.trim().slice(0, 40);
    return snippet.length < firstUserMessage.trim().length ? `${snippet}…` : snippet;
  }
  return `Диалог от ${formatDate(createdAt)}`;
}

interface SessionHistoryProps {
  /** Renders a close button when provided (drawer mode on tablet / mobile). */
  onClose?: () => void;
}

export function SessionHistory({ onClose }: SessionHistoryProps) {
  const sessionsQuery = useChatSessions();
  const activeSessionId = useActiveSessionStore((s) => s.activeSessionId);
  const setActiveSession = useActiveSessionStore((s) => s.setActiveSession);
  const createSession = useCreateSession();

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
            aria-label={`Диалог: ${sessionTitle(
              session.messages.find((m) => m.role === "user")?.content,
              session.createdAt
            )}`}
          >
            <span className={styles.sessionTitle}>
              {sessionTitle(
                session.messages.find((m) => m.role === "user")?.content,
                session.createdAt
              )}
            </span>
            <span className={styles.sessionDate}>{formatDate(session.updatedAt)}</span>
          </button>
        ))}
      </div>

      <div className={styles.footer}>
        <div className={styles.footerItem}>
          <BarChart3 aria-hidden="true" />
          Статистика
        </div>
      </div>
    </div>
  );
}
