import {
  coreShortcuts,
  findShortcutConflicts,
  type StudioShortcut,
  type ShortcutConflict,
} from "./shortcuts.js";

export const shortcutProfileStorageKey = "chai-studio.shortcut-profile.v1";
export const shortcutProfileVersion = 1;

export interface ShortcutBinding {
  readonly commandId: string;
  readonly key: string;
  readonly modifiers: readonly ("Alt" | "Control" | "Meta" | "Shift")[];
  readonly enabled: boolean;
}

export interface ShortcutProfile {
  readonly version: 1;
  readonly bindings: readonly ShortcutBinding[];
}

export interface ShortcutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const defaultShortcutProfile = (): ShortcutProfile => ({
  version: shortcutProfileVersion,
  bindings: coreShortcuts.map((shortcut) => ({
    commandId: shortcut.commandId,
    key: shortcut.key,
    modifiers: [...(shortcut.modifiers ?? [])],
    enabled: shortcut.enabled !== false,
  })),
});

export const applyShortcutProfile = (
  profile: ShortcutProfile,
  source: readonly StudioShortcut[] = coreShortcuts,
): readonly StudioShortcut[] => {
  assertShortcutProfile(profile, source);
  const byCommand = new Map(profile.bindings.map((binding) => [binding.commandId, binding]));
  return source.map((shortcut) => {
    const binding = byCommand.get(shortcut.commandId);
    return binding === undefined
      ? shortcut
      : {
          ...shortcut,
          key: binding.key,
          modifiers: binding.modifiers,
          enabled: binding.enabled,
        };
  });
};

export const updateShortcutBinding = (
  profile: ShortcutProfile,
  binding: ShortcutBinding,
  conflictPolicy: "reject" | "disable-conflicts",
): ShortcutProfile => {
  const base = profile.bindings.filter((item) => item.commandId !== binding.commandId);
  let candidate: ShortcutProfile = { version: 1, bindings: [...base, normalizeBinding(binding)] };
  assertShortcutProfile(candidate);
  const conflicts = conflictsForProfile(candidate);
  if (conflicts.length === 0) return candidate;
  if (conflictPolicy === "reject") {
    throw new Error(`Shortcut conflicts with ${conflicts.flatMap((item) => item.commands).join(", ")}.`);
  }
  const conflictingCommands = new Set(
    conflicts.flatMap((item) => item.commands).filter((commandId) => commandId !== binding.commandId),
  );
  candidate = {
    ...candidate,
    bindings: candidate.bindings.map((item) =>
      conflictingCommands.has(item.commandId) ? { ...item, enabled: false } : item,
    ),
  };
  return candidate;
};

export const conflictsForProfile = (profile: ShortcutProfile): readonly ShortcutConflict[] =>
  findShortcutConflicts(applyShortcutProfile(profile));

export const exportShortcutProfile = (profile: ShortcutProfile): string => {
  assertShortcutProfile(profile);
  return `${JSON.stringify(profile, null, 2)}\n`;
};

export const importShortcutProfile = (serialized: string): ShortcutProfile => {
  const value: unknown = JSON.parse(serialized);
  if (value === null || typeof value !== "object") throw new Error("Shortcut profile must be an object.");
  const record = value as Readonly<Record<string, unknown>>;
  if (record.version !== 1 || !Array.isArray(record.bindings)) {
    throw new Error("Shortcut profile version or bindings are invalid.");
  }
  const profile: ShortcutProfile = {
    version: 1,
    bindings: record.bindings.map((value) => parseBinding(value)),
  };
  assertShortcutProfile(profile);
  return profile;
};

export const loadShortcutProfile = (storage: ShortcutStorage = localStorage): ShortcutProfile => {
  try {
    const serialized = storage.getItem(shortcutProfileStorageKey);
    if (serialized === null) return defaultShortcutProfile();
    return importShortcutProfile(serialized);
  } catch {
    return defaultShortcutProfile();
  }
};

export const saveShortcutProfile = (
  profile: ShortcutProfile,
  storage: ShortcutStorage = localStorage,
): void => {
  const serialized = exportShortcutProfile(profile);
  try {
    storage.setItem(shortcutProfileStorageKey, serialized);
  } catch {
    // The validated profile remains active for this session when persistence is unavailable.
  }
};

const assertShortcutProfile = (
  profile: ShortcutProfile,
  source: readonly StudioShortcut[] = coreShortcuts,
): void => {
  const supported = new Set(source.map((shortcut) => shortcut.commandId));
  const seen = new Set<string>();
  for (const binding of profile.bindings) {
    if (!supported.has(binding.commandId)) throw new Error(`Unknown shortcut command ${binding.commandId}.`);
    if (seen.has(binding.commandId)) throw new Error(`Duplicate shortcut command ${binding.commandId}.`);
    seen.add(binding.commandId);
    normalizeBinding(binding);
  }
};

const normalizeBinding = (binding: ShortcutBinding): ShortcutBinding => {
  const key = binding.key === " " ? " " : binding.key.trim();
  if (key.length === 0 || key.length > 32) throw new Error("Shortcut key must contain 1-32 characters.");
  const modifiers = [...new Set(binding.modifiers)].sort();
  if (modifiers.some((modifier) => !["Alt", "Control", "Meta", "Shift"].includes(modifier))) {
    throw new Error("Shortcut modifier is invalid.");
  }
  return { ...binding, key, modifiers };
};

const parseBinding = (value: unknown): ShortcutBinding => {
  if (value === null || typeof value !== "object") throw new Error("Shortcut binding is invalid.");
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record.commandId !== "string" ||
    typeof record.key !== "string" ||
    typeof record.enabled !== "boolean" ||
    !Array.isArray(record.modifiers) ||
    record.modifiers.some((modifier) => typeof modifier !== "string")
  ) {
    throw new Error("Shortcut binding fields are invalid.");
  }
  return normalizeBinding({
    commandId: record.commandId,
    key: record.key,
    enabled: record.enabled,
    modifiers: record.modifiers as ShortcutBinding["modifiers"],
  });
};
