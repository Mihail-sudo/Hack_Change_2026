import { useEffect, useState } from "react";
import { SessionHistory } from "@/widgets/session-history";
import { ChatWorkspace } from "@/widgets/chat-workspace";
import { DebugPanel } from "@/widgets/debug-panel";
import { useDrawerFocus } from "@/shared/lib";
import { useActiveSessionStore, useChatSession } from "@/features/chat";
import styles from "./ChatPage.module.css";

// Must match the CSS breakpoints in ChatPage.module.css
const DESKTOP_BREAKPOINT = "(min-width: 1280px)";

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_BREAKPOINT).matches
  );

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_BREAKPOINT);
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return isDesktop;
}

export function ChatPage() {
  const isDesktop = useIsDesktop();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  const activeSessionId = useActiveSessionStore((s) => s.activeSessionId);
  const { data: activeSession } = useChatSession(activeSessionId);
  const lastAssistantMessage =
    activeSession?.messages.filter((m) => m.role === "assistant").at(-1) ?? null;
  const isRequestPending = activeSession?.messages.some((m) => m.status === "pending") ?? false;

  const historyRef = useDrawerFocus<HTMLElement>({
    onClose: () => setIsHistoryOpen(false),
    enabled: !isDesktop && isHistoryOpen,
  });
  const debugRef = useDrawerFocus<HTMLElement>({
    onClose: () => setIsDebugOpen(false),
    enabled: !isDesktop && isDebugOpen,
  });

  const isOverlayVisible = !isDesktop && (isHistoryOpen || isDebugOpen);

  return (
    <div className={styles.chatPage}>
      {isOverlayVisible && (
        <div
          className={styles.backdrop}
          onClick={() => {
            setIsHistoryOpen(false);
            setIsDebugOpen(false);
          }}
          aria-hidden="true"
        />
      )}

      <aside
        ref={historyRef}
        className={`${styles.leftPanel} ${isHistoryOpen ? styles.panelOpen : ""}`}
        aria-label="История диалогов"
        aria-hidden={isDrawerHidden(isDesktop, isHistoryOpen)}
        tabIndex={-1}
      >
        <SessionHistory onClose={() => setIsHistoryOpen(false)} />
      </aside>

      <main className={styles.centerPanel}>
        <ChatWorkspace
          onOpenHistory={() => setIsHistoryOpen(true)}
          onOpenDebug={() => setIsDebugOpen(true)}
        />
      </main>

      <aside
        ref={debugRef}
        className={`${styles.rightPanel} ${isDebugOpen ? styles.panelOpen : ""}`}
        aria-label="Режим отладки"
        aria-hidden={isDrawerHidden(isDesktop, isDebugOpen)}
        tabIndex={-1}
      >
        <DebugPanel
          onClose={() => setIsDebugOpen(false)}
          sessionId={activeSessionId}
          lastAssistantMessage={lastAssistantMessage}
          isRequestPending={isRequestPending}
        />
      </aside>
    </div>
  );
}

/** Closed drawers are removed from the a11y tree and Tab order on non-desktop screens. */
function isDrawerHidden(isDesktop: boolean, isOpen: boolean): boolean | undefined {
  return !isDesktop && !isOpen ? true : undefined;
}
