export const accessibilityStorageKey = "chai-studio.accessibility.v1";

export interface AccessibilityPreferences {
  readonly version: 1;
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
  readonly textScale: 1 | 1.15 | 1.3;
  readonly screenReaderSummaries: boolean;
}

export interface AccessibilityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const defaultAccessibilityPreferences = (): AccessibilityPreferences => ({
  version: 1,
  highContrast: false,
  reducedMotion: false,
  textScale: 1,
  screenReaderSummaries: true,
});

export const loadAccessibilityPreferences = (
  storage: AccessibilityStorage = localStorage,
): AccessibilityPreferences => {
  const serialized = storage.getItem(accessibilityStorageKey);
  if (serialized === null) return defaultAccessibilityPreferences();
  try {
    return parseAccessibilityPreferences(JSON.parse(serialized));
  } catch {
    return defaultAccessibilityPreferences();
  }
};

export const saveAccessibilityPreferences = (
  preferences: AccessibilityPreferences,
  storage: AccessibilityStorage = localStorage,
): void => {
  const validated = parseAccessibilityPreferences(preferences);
  storage.setItem(accessibilityStorageKey, JSON.stringify(validated));
};

export const applyAccessibilityPreferences = (
  element: HTMLElement,
  preferences: AccessibilityPreferences,
): void => {
  const validated = parseAccessibilityPreferences(preferences);
  element.dataset.highContrast = String(validated.highContrast);
  element.dataset.reducedMotion = String(validated.reducedMotion);
  element.dataset.textScale = String(validated.textScale);
  element.dataset.screenReaderSummaries = String(validated.screenReaderSummaries);
  element.style.setProperty("--accessibility-text-scale", String(validated.textScale));
};

const parseAccessibilityPreferences = (value: unknown): AccessibilityPreferences => {
  if (value === null || typeof value !== "object") throw new Error("Accessibility preferences are invalid.");
  const record = value as Readonly<Record<string, unknown>>;
  if (
    record.version !== 1 ||
    typeof record.highContrast !== "boolean" ||
    typeof record.reducedMotion !== "boolean" ||
    ![1, 1.15, 1.3].includes(record.textScale as number) ||
    typeof record.screenReaderSummaries !== "boolean"
  ) {
    throw new Error("Accessibility preference fields are invalid.");
  }
  return {
    version: 1,
    highContrast: record.highContrast,
    reducedMotion: record.reducedMotion,
    textScale: record.textScale as AccessibilityPreferences["textScale"],
    screenReaderSummaries: record.screenReaderSummaries,
  };
};
