import { useState } from "react";
import { X } from "lucide-react";
import type { ChatMessage } from "@/shared/types/chat";
import styles from "./DebugPanel.module.css";

interface DebugPanelProps {
  /** Закрыть панель (drawer-режим на tablet / mobile). */
  onClose?: () => void;
  /** Активная сессия для отображения технической информации. */
  sessionId?: string | null;
  /** Последнее сообщение ассистента (время ответа, источники RAG). */
  lastAssistantMessage?: ChatMessage | null;
  /** Идёт ли ожидание ответа ассистента. */
  isRequestPending?: boolean;
}

function formatResponseTime(ms?: number): string {
  if (ms === undefined) return "нет данных";
  return `${(ms / 1000).toFixed(2).replace(".", ",")} с`;
}

/**
 * Панель отладки показывает только те данные, которые реально вернул API-слой.
 * Отсутствующие метрики отображаются как «нет данных», а не выдуманные значения.
 * В mock-режиме источники RAG не возвращаются — секция честно это отражает.
 */
export function DebugPanel({
  onClose,
  sessionId,
  lastAssistantMessage,
  isRequestPending = false,
}: DebugPanelProps) {
  const [debugEnabled, setDebugEnabled] = useState(true);
  const sources = lastAssistantMessage?.sources ?? [];

  return (
    <div className={styles.debugPanel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Режим отладки</h2>
        <div className={styles.headerControls}>
          <button
            className={`${styles.switch} ${debugEnabled ? styles.switchOn : ""}`}
            onClick={() => setDebugEnabled((v) => !v)}
            role="switch"
            aria-checked={debugEnabled}
            aria-label="Включить режим отладки"
          >
            <span className={styles.switchKnob} />
          </button>
          {onClose && (
            <button
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Закрыть режим отладки"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {debugEnabled && (
        <>
          <section className={styles.section} aria-label="Время ответа">
            <h3 className={styles.sectionTitle}>Время ответа</h3>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Последний ответ</span>
              <span className={styles.metricValue}>
                {formatResponseTime(lastAssistantMessage?.responseTimeMs)}
              </span>
            </div>
          </section>

          <section className={styles.section} aria-label="Источники RAG">
            <h3 className={styles.sectionTitle}>Источники RAG</h3>
            {sources.length > 0 ? (
              sources.map((source) => (
                <div key={source.id} className={styles.sourceItem}>
                  <div className={styles.sourceHeader}>
                    <span className={styles.sourceTitle}>{source.title}</span>
                  </div>
                  <div className={styles.sourceMeta}>
                    {source.page !== undefined && <span>стр. {source.page}</span>}
                    {source.score !== undefined && <span>score {source.score.toFixed(2)}</span>}
                  </div>
                </div>
              ))
            ) : (
              <p className={styles.noData}>нет данных: backend не вернул источники</p>
            )}
          </section>

          <section className={styles.section} aria-label="Техническая информация">
            <h3 className={styles.sectionTitle}>Сессия</h3>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Идентификатор сессии</span>
              <span className={styles.sessionIdValue}>
                {sessionId ?? "— создается…"}
              </span>
              <span className={styles.metricLabel}>Статус запроса</span>
              <span className={isRequestPending ? styles.statusPending : styles.statusIdle}>
                {isRequestPending ? "ожидание ответа" : "нет активных запросов"}
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
