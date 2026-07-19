import { describe, expect, it } from "vitest";
import {
  defaultLayouts,
  layoutStorageVersion,
  loadWorkspaceLayout,
  normalizeLayout,
  saveWorkspaceLayout,
} from "../../apps/studio-web/src/layout-store.js";
import {
  coreShortcuts,
  findShortcutConflicts,
  shortcutForEvent,
  shortcutSignature,
  type StudioShortcut,
} from "../../apps/studio-web/src/shortcuts.js";

describe("Studio workspace layouts", () => {
  it("bounds stored dimensions so monitor and timeline keep priority", () => {
    expect(
      normalizeLayout(
        { leftWidth: 5_000, rightWidth: -20, lowerHeight: 9_000 },
        defaultLayouts.edit,
        1_200,
        800,
      ),
    ).toMatchObject({ leftWidth: 408, rightWidth: 240, lowerHeight: 384 });
  });

  it("persists a versioned workspace layout and restores it", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const layout = { ...defaultLayouts.inspect, leftCollapsed: true };
    saveWorkspaceLayout("inspect", layout, storage);
    expect([...values.values()][0]).toContain(`"version":${String(layoutStorageVersion)}`);
    expect(loadWorkspaceLayout("inspect", storage)).toEqual(layout);
  });

  it("rejects stale review layouts and repairs an open zero-height lower panel", () => {
    const values = new Map<string, string>();
    const currentKey = `chai-studio.workspace-layout.v${String(layoutStorageVersion)}.edit`;
    values.set(
      currentKey,
      JSON.stringify({
        version: layoutStorageVersion - 1,
        workspace: "edit",
        layout: { ...defaultLayouts.edit, lowerHeight: 0, lowerCollapsed: false },
      }),
    );
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    expect(loadWorkspaceLayout("edit", storage)).toEqual(defaultLayouts.edit);
    expect(
      normalizeLayout({ ...defaultLayouts.edit, lowerHeight: 0, lowerCollapsed: false }, defaultLayouts.edit)
        .lowerHeight,
    ).toBe(160);
  });
});

describe("Studio shortcut routing", () => {
  it("has no conflicts in the core keyboard map", () => {
    expect(findShortcutConflicts(coreShortcuts)).toEqual([]);
  });

  it("matches visible macOS workspace commands by normalized signature", () => {
    const shortcut = shortcutForEvent(
      { key: "2", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false, target: null },
      coreShortcuts,
      "edit",
    );
    expect(shortcut?.commandId).toBe("workspace.inspect");
    if (shortcut === null) throw new Error("Expected the Inspect shortcut to match.");
    expect(shortcutSignature(shortcut)).toBe("Meta+2");
  });

  it("reports conflicting commands without choosing a silent winner", () => {
    const duplicate: StudioShortcut = {
      commandId: "duplicate",
      label: "Duplicate",
      key: "c",
      scope: "global",
    };
    expect(findShortcutConflicts([...coreShortcuts, duplicate])).toEqual([
      { signature: "c", commands: ["capture.exact", "duplicate"] },
    ]);
  });
});
