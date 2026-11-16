import { Bot, User, RotateCcw } from "lucide-react";
import type { ChatMessage } from "@/shared/types/chat";
import { RecommendationCard } from "../recommendation-card";
import { TypingIndicator } from "../typing-indicator";
import styles from "./MessageBubble.module.css";

interface MessageBubbleProps {
  message: ChatMessage;
  /** Вызывается кнопкой «Повторить» у неудачного сообщения пользователя. */
  onRetry?: (content: string) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";

  return (
    <article
      className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant} ${
        isError ? styles.bubbleError : ""
      }`}
      aria-label={isUser ? "Сообщение пользователя" : "Ответ консультанта"}
      data-status={message.status}
    >
      <div
        className={`${styles.avatar} ${isUser ? styles.avatarUser : styles.avatarAssistant}`}
        aria-hidden="true"
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>

      <div className={styles.content}>
        {isPending ? (
          <TypingIndicator />
        ) : (
          <div
            className={`${styles.body} ${isUser ? styles.bodyUser : styles.bodyAssistant} ${
              isError ? styles.bodyError : ""
            }`}
          >
            {message.content}
          </div>
        )}

        {isError && (
          <div className={styles.errorRow} role="alert">
            <span className={styles.errorText}>Не удалось отправить сообщение.</span>
            {onRetry && (
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() => onRetry(message.content)}
                aria-label="Повторить отправку сообщения"
              >
                <RotateCcw size={14} aria-hidden="true" />
                Повторить
              </button>
            )}
          </div>
        )}

        {!isUser && !isPending && message.sources && message.sources.length > 0 && (
          <RecommendationCard sources={message.sources} />
        )}

        {!isPending && (
          <div className={styles.meta}>
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </div>
        )}
      </div>
    </article>
  );
}
