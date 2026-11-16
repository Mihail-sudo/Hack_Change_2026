/**
 * Персистентное хранение пользовательских настроек UI в localStorage.
 *
 * Хранит: видимость боковых панелей, ширину панелей.
 * Данные версионированы для безопасной миграции формата.
 *
 * В отличие от sessionStorage, эти настройки не относятся к сессиям
 * и не должны сбрасываться между диалогами.
 */

const UI_PREFS_KEY = "energytool.ui.v1";

export interface UIPreferences {
  version: 1;
  /** Видимость левой панели (история). null означает "использовать значение по умолчанию". */
  leftSidebarVisible: boolean | null;
  /** Видимость правой панели (DebugPanel). null — по умолчанию. */
  rightSidebarVisible: boolean | null;
  /** Ширина левой панели в пикселях. 0 означает "использовать CSS-значение по умолчанию". */
  leftSidebarWidth: number;
  /** Ширина правой панели в пикселях. 0 —默认值. */
  rightSidebarWidth: number;
}

const DEFAULT_PREFERENCES: UIPreferences = {
  version: 1,
  leftSidebarVisible: null,
  rightSidebarVisible: null,
  leftSidebarWidth: 0,
  rightSidebarWidth: 0,
};

/**
 * Загружает пользовательские настройки UI.
 * При ошибке возвращает значения по умолчанию.
 */
export function loadUIPreferences(): UIPreferences {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      if ((parsed as UIPreferences).version === 1) {
        return { ...DEFAULT_PREFERENCES, ...(parsed as UIPreferences) };
      }
    }
    return { ...DEFAULT_PREFERENCES };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Сохраняет пользовательские настройки UI.
 * При недоступности localStorage — молча игнорирует.
 */
export function saveUIPreferences(prefs: UIPreferences): void {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable
  }
}

/** Обновляет конкретное поле настроек. */
export function updateUIPreferences(
  current: UIPreferences,
  updates: Partial<UIPreferences>
): UIPreferences {
  return { ...current, ...updates };
}
