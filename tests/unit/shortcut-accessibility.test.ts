import { describe, expect, it, vi } from "vitest";
import {
  applyAccessibilityPreferences,
  defaultAccessibilityPreferences,
  loadAccessibilityPreferences,
  saveAccessibilityPreferences,
} from "../../apps/studio-web/src/accessibility.js";
import {
  applyShortcutProfile,
  conflictsForProfile,
  defaultShortcutProfile,
  exportShortcutProfile,
  importShortcutProfile,
  loadShortcutProfile,
  saveShortcutProfile,
  updateShortcutBinding,
} from "../../apps/studio-web/src/shortcut-profile.js";

describe("P26 shortcut customization and accessibility persistence", () => {
  it("round-trips a versioned shortcut profile", () => {
    const profile = defaultShortcutProfile();
    expect(importShortcutProfile(exportShortcutProfile(profile))).toEqual(profile);
    expect(conflictsForProfile(profile)).toEqual([]);
  });

  it("rejects a collision or explicitly disables the conflicting command", () => {
    const profile = defaultShortcutProfile();
    const binding = { commandId: "workspace.edit", key: "c", modifiers: [], enabled: true } as const;
    expect(() => updateShortcutBinding(profile, binding, "reject")).toThrow("Shortcut conflicts");
    const resolved = updateShortcutBinding(profile, binding, "disable-conflicts");
    expect(conflictsForProfile(resolved)).toEqual([]);
    expect(applyShortcutProfile(resolved).find((item) => item.commandId === "capture.exact")?.enabled).toBe(
      false,
    );
  });

  it("persists profiles locally and fails closed to defaults on invalid data", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveShortcutProfile(defaultShortcutProfile(), storage);
    expect(loadShortcutProfile(storage)).toEqual(defaultShortcutProfile());
    values.set("chai-studio.shortcut-profile.v1", "not-json");
    expect(loadShortcutProfile(storage)).toEqual(defaultShortcutProfile());
  });

  it("persists high contrast, reduced motion, text scale, and summaries", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const preferences = {
      ...defaultAccessibilityPreferences(),
      highContrast: true,
      reducedMotion: true,
      textScale: 1.3 as const,
    };
    saveAccessibilityPreferences(preferences, storage);
    expect(loadAccessibilityPreferences(storage)).toEqual(preferences);

    const setProperty = vi.fn();
    const element = { dataset: {}, style: { setProperty } } as unknown as HTMLElement;
    applyAccessibilityPreferences(element, preferences);
    expect(element.dataset).toEqual({
      highContrast: "true",
      reducedMotion: "true",
      screenReaderSummaries: "true",
      textScale: "1.3",
    });
    expect(setProperty).toHaveBeenCalledWith("--accessibility-text-scale", "1.3");
  });

  it("falls back to safe accessibility defaults for missing or invalid records", () => {
    expect(loadAccessibilityPreferences({ getItem: () => null, setItem: () => undefined })).toEqual(
      defaultAccessibilityPreferences(),
    );
    expect(
      loadAccessibilityPreferences({
        getItem: () => JSON.stringify({ ...defaultAccessibilityPreferences(), textScale: 2 }),
        setItem: () => undefined,
      }),
    ).toEqual(defaultAccessibilityPreferences());
  });
});
