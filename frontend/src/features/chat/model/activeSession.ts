import { create } from "zustand";

interface ActiveSessionState {
  activeSessionId: string | null;
  setActiveSession: (sessionId: string | null) => void;
  /** Закрывает активный контекст диалога: контекст сбрасывается, история сохраняется. */
  closeSession: () => void;
}

export const useActiveSessionStore = create<ActiveSessionState>()((set) => ({
  activeSessionId: null,
  setActiveSession: (activeSessionId) => set({ activeSessionId }),
  closeSession: () => set({ activeSessionId: null }),
}));

export function getActiveSessionId(): string | null {
  return useActiveSessionStore.getState().activeSessionId;
}

