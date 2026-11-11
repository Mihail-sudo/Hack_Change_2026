import { useState, type KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";
import styles from "./MessageComposer.module.css";

interface MessageComposerProps {
  /** Блокирует отправку, пока ассистент отвечает. */
  disabled?: boolean;
  onSend: (content: string) => void;
}

export function MessageComposer({ disabled = false, onSend }: MessageComposerProps) {
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.composer}>
      <textarea
        className={styles.textarea}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Опишите вашу задачу..."
        aria-label="Поле ввода сообщения"
        aria-disabled={disabled || undefined}
        rows={1}
      />
      <button
        className={styles.sendBtn}
        onClick={handleSend}
        disabled={!canSend}
        aria-label={disabled ? "Ассистент отвечает" : "Отправить сообщение"}
      >
        <SendHorizontal size={18} />
      </button>
    </div>
  );
}
