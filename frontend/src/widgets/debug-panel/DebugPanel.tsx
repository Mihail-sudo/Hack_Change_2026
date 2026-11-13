import { useState } from "react";
import { ChevronRight, FileText, CheckCircle2, Clock } from "lucide-react";
import type { ChatMessage } from "@/shared/types/chat";
import { chatApi } from "@/shared/api";
import styles from "./DebugPanel.module.css";

interface DebugPanelProps {
  /** Все сообщения текущей сессии. */
  messages: ChatMessage[];
  /** ID текущей сессии. */
  sessionId?: string | null;
  /** Открыть панель (drawer-режим на tablet / mobile). */
  onClose?: () => void;
}

function formatResponseTime(ms?: number): string {
  if (ms === undefined) return "—";
  return `${(ms / 1000).toFixed(2)} с`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function MessageDebugView({
  message,
  isMock,
}: {
  message: ChatMessage;
  isMock: boolean;
}) {
  const sources = message.sources ?? [];

  return (
    <div className={styles.messageDebug}>
      <div className={styles.messageHeader}>
        <span className={styles.messageTime}>
          <Clock size={12} aria-hidden="true" />
          {formatTime(message.createdAt)}
        </span>
        <span className={styles.messageDuration}>{formatResponseTime(message.responseTimeMs)}</span>
      </div>

      {isMock && (
        <span className={styles.mockBadge}>
          <FileText size={11} aria-hidden="true" />
          демо-данные
        </span>
      )}

      {/* Источники RAG */}
      <div className={styles.sourcesSection}>
        <span className={styles.sourcesLabel}>Источники RAG</span>
        {sources.length === 0 ? (
          <span className={styles.noData}>нет данных</span>
        ) : (
          sources.map((source) => (
            <div key={source.id} className={styles.sourceItem}>
              <div className={styles.sourceHeader}>
                <span className={styles.sourceTitle}>{source.title}</span>
                {source.score !== undefined && (
                  <span className={styles.scoreBadge}>{source.score.toFixed(2)}</span>
                )}
              </div>
              {source.excerpt && (
                <p className={styles.sourceExcerpt}>{source.excerpt}</p>
              )}
              <div className={styles.sourceMeta}>
                {source.page !== undefined && <span>стр. {source.page}</span>}
                {source.url && (
                  <span className={styles.sourceUrl}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      источник
                    </a>
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Debug panel with per-message view.
 *
 * Показывает отладочные данные для каждого сообщения ассистента в текущей сессии.
 * Данные привязаны к конкретному messageId — не смешиваются между сообщениями.
 *
 * В mock-режиме все метрики честно обозначены как «демо-данные».
 * Пустые значения отображаются как «нет данных», не как выдуманные значения.
 */
export function DebugPanel({ messages, sessionId, onClose }: DebugPanelProps) {
  const [debugEnabled, setDebugEnabled] = useState(true);

  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isMock = chatApi.mode === "mock";

  const currentMessage = assistantMessages[selectedIndex] ?? null;

  return (
    <div className={styles.debugPanel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Режим отладки</h2>
        <div className={styles.headerControls}>
          <button
            className={`${styles.switch} ${debugEnabled ? styles.switchOn : ""}`}
            onClick={() => setDebugEnabled((v) => !v)}
            role="switch"
            aria-checked={debugEnabled}
            aria-label={debugEnabled ? "Выключить режим отладки" : "Включить режим отладки"}
          >
            <span className={styles.switchKnob} />
          </button>
          {onClose && (
            <button className={styles.closeButton} onClick={onClose} aria-label="Закрыть режим отладки">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {debugEnabled && (
        <>
          {/* Сессия */}
          <section className={styles.section} aria-label="Сессия">
            <h3 className={styles.sectionTitle}>Сессия</h3>
            <div className={styles.metricCard}>
              <div className={styles.metricRow}>
                <span className={styles.metricLabel}>ID сессии</span>
                <span className={styles.sessionIdValue}>{sessionId ?? "—"}</span>
              </div>
              <div className={styles.metricRow}>
                <span className={styles.metricLabel}>Сообщений ассистента</span>
                <span className={styles.metricValue}>{assistantMessages.length}</span>
              </div>
              {isMock && (
                <div className={styles.mockNote}>
                  <FileText size={11} aria-hidden="true" />
                  Mock-режим — источники RAG не предоставляются
                </div>
              )}
            </div>
          </section>

          {/* Per-message selector */}
          {assistantMessages.length > 0 && (
            <section className={styles.section} aria-label="Сообщения">
              <h3 className={styles.sectionTitle}>Сообщения ассистента</h3>
              <div className={styles.messageList} role="list" aria-label="Выберите сообщение">
                {assistantMessages.map((msg, i) => (
                  <button
                    key={msg.id}
                    type="button"
                    role="listitem"
                    className={`${styles.messageItem} ${i === selectedIndex ? styles.messageItemActive : ""}`}
                    onClick={() => setSelectedIndex(i)}
                    aria-current={i === selectedIndex ? "true" : undefined}
                    aria-label={`Сообщение ${i + 1}, ${formatTime(msg.createdAt)}`}
                  >
                    <span className={styles.messageItemIndex}>{i + 1}</span>
                    <span className={styles.messageItemTime}>{formatTime(msg.createdAt)}</span>
                    <span className={styles.messageItemDuration}>
                      {msg.responseTimeMs !== undefined ? formatResponseTime(msg.responseTimeMs) : "—"}
                    </span>
                    {msg.sources && msg.sources.length > 0 && (
                      <span className={styles.sourceCountBadge} aria-label={`${msg.sources.length} источников`}>
                        <CheckCircle2 size={11} aria-hidden="true" />
                        {msg.sources.length}
                      </span>
                    )}
                    <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Selected message debug view */}
          {currentMessage && (
            <section className={styles.section} aria-label="Детали сообщения">
              <h3 className={styles.sectionTitle}>
                Ответ #{selectedIndex + 1}
                <span className={styles.sectionSubtitle}>
                  {formatTime(currentMessage.createdAt)}
                </span>
              </h3>
              <MessageDebugView message={currentMessage} isMock={isMock} />
            </section>
          )}

          {assistantMessages.length === 0 && (
            <div className={styles.emptyState}>
              <p>Нет ответов ассистента в этой сессии.</p>
              <p>Отправьте сообщение, чтобы увидеть отладочные данные.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}