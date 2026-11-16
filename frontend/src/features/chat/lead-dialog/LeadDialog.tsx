import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ChatMessage } from "@/shared/types/chat";
import { LeadForm } from "../lead-form";
import styles from "./LeadDialog.module.css";

interface LeadDialogProps {
  /** Открыт ли диалог. */
  isOpen: boolean;
  /** Закрыть диалог. */
  onClose: () => void;
  /** Текущие сообщения для резюме. */
  messages: ChatMessage[];
  /** ID активной сессии. */
  sessionId: string;
}

/**
 * Модальный диалог заявки менеджеру.
 * Использует React Portal для рендера поверх контента.
 * Закрывается по Escape, клику на backdrop, и кнопке закрытия.
 */
export function LeadDialog({ isOpen, onClose, messages, sessionId }: LeadDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the dialog on open
    const timer = setTimeout(() => {
      dialogRef.current?.focus();
    }, 0);

    // Close on Escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;

        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown, true);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.overlay} aria-hidden="true" onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Заявка менеджеру"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Закрыть заявку"
        >
          <X size={20} aria-hidden="true" />
        </button>

        <LeadForm
          messages={messages}
          sessionId={sessionId}
          onSuccess={() => {
            // Dialog stays open — user can close manually or continue chatting
            // Success state is shown inside the form
          }}
        />
      </div>
    </div>,
    document.body
  );
}
