/**
 * Публичная конфигурация API. Единственное место, где читается адрес backend —
 * localhost нигде больше в коде не хардкодится.
 *
 * VITE_API_BASE_URL — публичная переменная (без секретов): она попадает в браузер.
 */

const DEFAULT_API_BASE_URL = "http://localhost:8000";

/** Базовый URL backend без завершающего слэша. */
export const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

/**
 * Режим чата: "live" — запросы к реальному backend, иначе mock.
 * Управляется переменной VITE_CHAT_API (см. .env.example).
 */
export const CHAT_API_MODE: "mock" | "live" =
  import.meta.env.VITE_CHAT_API === "live" ? "live" : "mock";
