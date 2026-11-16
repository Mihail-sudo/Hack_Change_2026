/**
 * Тесты персистентности настроек UI (видимость панелей, ширины).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadUIPreferences,
  saveUIPreferences,
  updateUIPreferences,
} from "./uiPreferences";

const PREFS_KEY = "energytool.ui.v1";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("uiPreferences", () => {
  it("пустое хранилище → настройки по умолчанию", () => {
    const prefs = loadUIPreferences();
    expect(prefs).toMatchObject({
      version: 1,
      leftSidebarVisible: null,
      rightSidebarVisible: null,
      leftSidebarWidth: 0,
      rightSidebarWidth: 0,
    });
  });

  it("сохранённые настройки восстанавливаются", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        version: 1,
        leftSidebarVisible: false,
        rightSidebarVisible: true,
        leftSidebarWidth: 350,
        rightSidebarWidth: 420,
      })
    );

    const prefs = loadUIPreferences();
    expect(prefs.leftSidebarVisible).toBe(false);
    expect(prefs.rightSidebarVisible).toBe(true);
    expect(prefs.leftSidebarWidth).toBe(350);
    expect(prefs.rightSidebarWidth).toBe(420);
  });

  it("malformed JSON → настройки по умолчанию без падения", () => {
    localStorage.setItem(PREFS_KEY, "{{{");
    expect(() => loadUIPreferences()).not.toThrow();
    expect(loadUIPreferences().version).toBe(1);
  });

  it("недоступный localStorage не роняет приложение", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(loadUIPreferences().version).toBe(1);
    expect(() =>
      saveUIPreferences({
        version: 1,
        leftSidebarVisible: true,
        rightSidebarVisible: true,
        leftSidebarWidth: 0,
        rightSidebarWidth: 0,
      })
    ).not.toThrow();
  });

  it("updateUIPreferences обновляет только переданные поля", () => {
    const base = loadUIPreferences();
    const updated = updateUIPreferences(base, { leftSidebarVisible: false });

    expect(updated.leftSidebarVisible).toBe(false);
    expect(updated.rightSidebarVisible).toBeNull();
    expect(updated.leftSidebarWidth).toBe(0);
  });

  it("сохранение и повторная загрузка дают те же значения (round-trip)", () => {
    saveUIPreferences({
      version: 1,
      leftSidebarVisible: false,
      rightSidebarVisible: true,
      leftSidebarWidth: 320,
      rightSidebarWidth: 400,
    });

    const prefs = loadUIPreferences();
    expect(prefs.leftSidebarVisible).toBe(false);
    expect(prefs.rightSidebarVisible).toBe(true);
    expect(prefs.leftSidebarWidth).toBe(320);
    expect(prefs.rightSidebarWidth).toBe(400);
  });
});
