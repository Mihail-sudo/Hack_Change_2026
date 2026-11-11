import { create } from "zustand";

interface ActiveSessionState {
  activeSessionId: string | null;
  setActiveSession: (sessionId: string | null) => void;
}

/**
 * Общий клиентский стейт: id активной сессии нужен одновременно чату,
 * истории диалогов и debug-панели. Данные сессий при этом живут в TanStack Query.
 */
export const useActiveSessionStore = create<ActiveSessionState>()((set) => ({
  activeSessionId: null,
  setActiveSession: (activeSessionId) => set({ activeSessionId }),
}));

export function getActiveSessionId(): string | null {
  return useActiveSessionStore.getState().activeSessionId;
}
