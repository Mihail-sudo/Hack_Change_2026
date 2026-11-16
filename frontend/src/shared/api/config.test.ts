/**
 * Тесты конфигурации приложения: интерпретация VITE_DEBUG_PANEL_ENABLED.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

describe("config: DEBUG_PANEL_ENABLED", () => {
  const originalEnv = { ...import.meta.env };
  // import.meta.env типизирован как readonly — для тестов нужен мутируемый алиас
  const mutableEnv = import.meta.env as Record<string, string | undefined>;

  afterEach(() => {
    // Восстанавливаем env и кэш модулей после каждого теста
    Object.assign(import.meta.env, originalEnv);
    vi.resetModules();
  });

  async function loadConfig(): Promise<{ DEBUG_PANEL_ENABLED: boolean }> {
    // Свежий импорт модуля после сброса кэша и подмены env
    return await import("./config");
  }

  it("по умолчанию (переменная не установлена) DebugPanel включён", async () => {
    vi.resetModules();
    delete mutableEnv.VITE_DEBUG_PANEL_ENABLED;
    const config = await loadConfig();
    expect(config.DEBUG_PANEL_ENABLED).toBe(true);
  });

  it("VITE_DEBUG_PANEL_ENABLED=true включает панель", async () => {
    vi.resetModules();
    mutableEnv.VITE_DEBUG_PANEL_ENABLED = "true";
    const config = await loadConfig();
    expect(config.DEBUG_PANEL_ENABLED).toBe(true);
  });

  it("VITE_DEBUG_PANEL_ENABLED=false отключает панель", async () => {
    vi.resetModules();
    mutableEnv.VITE_DEBUG_PANEL_ENABLED = "false";
    const config = await loadConfig();
    expect(config.DEBUG_PANEL_ENABLED).toBe(false);
  });

  it("любое значение кроме 'false' оставляет панель включённой", async () => {
    vi.resetModules();
    mutableEnv.VITE_DEBUG_PANEL_ENABLED = "1";
    const config = await loadConfig();
    expect(config.DEBUG_PANEL_ENABLED).toBe(true);
  });
});
