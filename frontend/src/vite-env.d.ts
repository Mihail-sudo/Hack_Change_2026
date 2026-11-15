/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Адрес backend API (FastAPI), например http://localhost:8000. */
  readonly VITE_API_BASE_URL?: string;
  /** Режим чата: "mock" — локальная заглушка, "live" — реальный backend. */
  readonly VITE_CHAT_API?: string;
}
