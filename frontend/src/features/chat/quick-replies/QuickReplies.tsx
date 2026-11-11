import styles from "./QuickReplies.module.css";

interface QuickRepliesProps {
  replies: string[];
  disabled?: boolean;
  onSelect: (text: string) => void;
}

/** Быстрые ответы под последним сообщением ассистента. */
export function QuickReplies({ replies, disabled = false, onSelect }: QuickRepliesProps) {
  if (replies.length === 0) return null;

  return (
    <div className={styles.list} role="group" aria-label="Быстрые ответы">
      {replies.map((reply) => (
        <button
          key={reply}
          type="button"
          className={styles.reply}
          onClick={() => onSelect(reply)}
          disabled={disabled}
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
