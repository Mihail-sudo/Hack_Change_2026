import { useEffect, useState, useCallback } from "react";
import { SessionHistory } from "@/widgets/session-history";
import { ChatWorkspace } from "@/widgets/chat-workspace";
import { DebugPanel } from "@/widgets/debug-panel";
import { useDrawerFocus, useResizable } from "@/shared/lib";
import { DEBUG_PANEL_ENABLED } from "@/shared/api/config";
import { loadUIPreferences, saveUIPreferences } from "@/shared/api/chat/live/uiPreferences";
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
  const activeSessionId = useActiveSessionStore((s) => s.activeSessionId);
  const { data: activeSession } = useChatSession(activeSessionId);

  // Загружаем сохранённые настройки UI
  const [leftVisible, setLeftVisible] = useState(() => {
    const prefs = loadUIPreferences();
    return prefs.leftSidebarVisible ?? true;
  });
  const [rightVisible, setRightVisible] = useState(() => {
    const prefs = loadUIPreferences();
    return prefs.rightSidebarVisible ?? true;
  });

  // Ресайз левой панели (история)
  const {
    width: leftWidth,
    handleProps: leftResizeProps,
    isResizing: isLeftResizing,
  } = useResizable({
    side: "right",
    panel: "left",
    minWidth: 220,
    maxWidth: 480,
    initialWidth: 270,
    disabled: !isDesktop || !leftVisible,
  });

  // Ресайз правой панели (DebugPanel)
  const {
    width: rightWidth,
    handleProps: rightResizeProps,
    isResizing: isRightResizing,
  } = useResizable({
    side: "left",
    panel: "right",
    minWidth: 280,
    maxWidth: 500,
    initialWidth: 300,
    disabled: !isDesktop || !rightVisible || !DEBUG_PANEL_ENABLED,
  });

  // Переключатели видимости
  const toggleLeft = useCallback(() => {
    setLeftVisible((v) => {
      const newVal = !v;
      const prefs = loadUIPreferences();
      saveUIPreferences({ ...prefs, leftSidebarVisible: newVal });
      return newVal;
    });
  }, []);

  const toggleRight = useCallback(() => {
    if (!DEBUG_PANEL_ENABLED) return;
    setRightVisible((v) => {
      const newVal = !v;
      const prefs = loadUIPreferences();
      saveUIPreferences({ ...prefs, rightSidebarVisible: newVal });
      return newVal;
    });
  }, []);

  // Для drawer-режима на tablet/mobile
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  const historyRef = useDrawerFocus<HTMLElement>({
    onClose: () => setIsHistoryOpen(false),
    enabled: !isDesktop && isHistoryOpen,
  });
  const debugRef = useDrawerFocus<HTMLElement>({
    onClose: () => setIsDebugOpen(false),
    enabled: !isDesktop && isDebugOpen,
  });

  // На планшетах/мобильных — drawer-режим
  const isHistoryDrawer = !isDesktop;
  const isDebugDrawer = !isDesktop;

  // Показываем overlay если какой-то drawer открыт
  const isOverlayVisible = !isDesktop && (isHistoryOpen || isDebugOpen);

  const handleOpenHistory = useCallback(() => {
    if (isDesktop) {
      toggleLeft();
    } else {
      setIsHistoryOpen(true);
    }
  }, [isDesktop, toggleLeft]);

  const handleOpenDebug = useCallback(() => {
    if (!DEBUG_PANEL_ENABLED) return;
    if (isDesktop) {
      toggleRight();
    } else {
      setIsDebugOpen(true);
    }
  }, [isDesktop, toggleRight]);

  // Классы для панелей
  const leftPanelClass = [
    styles.leftPanel,
    isHistoryDrawer && isHistoryOpen ? styles.panelOpen : "",
  ]
    .filter(Boolean)
    .join(" ");

  const rightPanelClass = [
    styles.rightPanel,
    isDebugDrawer && isDebugOpen ? styles.panelOpen : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Стили для пользовательской ширины.
  // Во время drag подавляем transition, чтобы ширина следовала за курсором мгновенно.
  const leftPanelStyle: React.CSSProperties =
    isDesktop && leftVisible && leftWidth > 0
      ? {
          width: leftWidth,
          minWidth: leftWidth,
          ...(isLeftResizing ? { transition: "none" } : {}),
        }
      : {};

  const rightPanelStyle: React.CSSProperties =
    isDesktop && rightVisible && rightWidth > 0
      ? {
          width: rightWidth,
          minWidth: rightWidth,
          ...(isRightResizing ? { transition: "none" } : {}),
        }
      : {};

  // Нужно ли показывать хэндл для ресайза
  const showLeftHandle = isDesktop && leftVisible;
  const showRightHandle = isDesktop && rightVisible && DEBUG_PANEL_ENABLED;

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

      {/* Левая панель — История. На не-desktop рендерится всегда (drawer-режим). */}
      {(isDesktop ? leftVisible : true) && (
        <>
          <aside
            ref={historyRef}
            className={leftPanelClass}
            style={leftPanelStyle}
            aria-label="История диалогов"
            aria-hidden={isDrawerHidden(isDesktop, isHistoryOpen)}
            tabIndex={-1}
          >
            <SessionHistory
              onClose={isHistoryDrawer ? () => setIsHistoryOpen(false) : undefined}
            />
          </aside>

          {/* Хэндл ресайза для левой панели */}
          {showLeftHandle && !isLeftResizing && (
            <div
              className={`${styles.resizeHandle} ${styles.resizeHandleLeft}`}
              {...leftResizeProps}
            />
          )}
        </>
      )}

      {/* Центр — ChatWorkspace */}
      <main className={styles.centerPanel}>
        <ChatWorkspace
          onOpenHistory={handleOpenHistory}
          onOpenDebug={DEBUG_PANEL_ENABLED ? handleOpenDebug : undefined}
          isLeftSidebarVisible={isDesktop ? leftVisible : isHistoryOpen}
          isRightSidebarVisible={
            isDesktop ? rightVisible && DEBUG_PANEL_ENABLED : isDebugOpen
          }
        />
      </main>

      {/* Правая панель — DebugPanel. На не-desktop рендерится всегда (drawer-режим). */}
      {DEBUG_PANEL_ENABLED && (isDesktop ? rightVisible : true) && (
        <>
          {/* Хэндл ресайза для правой панели */}
          {showRightHandle && !isRightResizing && (
            <div
              className={`${styles.resizeHandle} ${styles.resizeHandleRight}`}
              {...rightResizeProps}
            />
          )}

          <aside
            ref={debugRef}
            className={rightPanelClass}
            style={rightPanelStyle}
            aria-label="Режим отладки"
            aria-hidden={isDrawerHidden(isDesktop, isDebugOpen)}
            tabIndex={-1}
          >
            <DebugPanel
              onClose={isDebugDrawer ? () => setIsDebugOpen(false) : undefined}
              sessionId={activeSessionId}
              messages={activeSession?.messages ?? []}
            />
          </aside>
        </>
      )}
    </div>
  );
}

/** Closed drawers are removed from the a11y tree and Tab order on non-desktop screens. */
function isDrawerHidden(
  isDesktop: boolean,
  isOpen: boolean
): boolean | undefined {
  return !isDesktop && !isOpen ? true : undefined;
}
