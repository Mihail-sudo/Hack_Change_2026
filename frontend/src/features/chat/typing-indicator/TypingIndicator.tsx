import styles from "./TypingIndicator.module.css";

/** Индикатор ожидания ответа ассистента (status region для screen reader). */
export function TypingIndicator() {
  return (
    <div className={styles.status} role="status" aria-label="Консультант готовит ответ">
      <span className={styles.dots} aria-hidden="true">
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </span>
      Консультант готовит ответ…
    </div>
  );
}
