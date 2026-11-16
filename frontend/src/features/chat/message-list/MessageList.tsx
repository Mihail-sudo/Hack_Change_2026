import type { ChatMessage } from "@/shared/types/chat";
import { MessageBubble } from "../message-bubble";
import styles from "./MessageList.module.css";

interface MessageListProps {
  messages: ChatMessage[];
  onRetry?: (content: string) => void;
}

export function MessageList({ messages, onRetry }: MessageListProps) {
  return (
    <div
      className={styles.messageList}
      role="log"
      aria-live="polite"
      aria-label="История сообщений"
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} onRetry={onRetry} />
      ))}
    </div>
  );
}
