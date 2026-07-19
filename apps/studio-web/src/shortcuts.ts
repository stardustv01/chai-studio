import type { WorkspaceId } from "./types.js";

export type ShortcutScope = "global" | "transport" | "timeline" | "workspace";

export interface StudioShortcut {
  readonly commandId: string;
  readonly label: string;
  readonly key: string;
  readonly modifiers?: readonly ("Alt" | "Control" | "Meta" | "Shift")[];
  readonly scope: ShortcutScope;
  readonly workspaces?: readonly WorkspaceId[];
  readonly allowInTextInput?: boolean;
  readonly enabled?: boolean;
}

export interface ShortcutConflict {
  readonly signature: string;
  readonly commands: readonly string[];
}

export const coreShortcuts: readonly StudioShortcut[] = [
  { commandId: "workspace.edit", label: "Edit workspace", key: "1", modifiers: ["Meta"], scope: "global" },
  {
    commandId: "workspace.inspect",
    label: "Inspect workspace",
    key: "2",
    modifiers: ["Meta"],
    scope: "global",
  },
  { commandId: "workspace.media", label: "Media workspace", key: "3", modifiers: ["Meta"], scope: "global" },
  {
    commandId: "workspace.animation",
    label: "Animation workspace",
    key: "4",
    modifiers: ["Meta"],
    scope: "global",
  },
  {
    commandId: "workspace.deliver",
    label: "Deliver workspace",
    key: "5",
    modifiers: ["Meta"],
    scope: "global",
  },
  { commandId: "transport.toggle", label: "Play or pause", key: " ", scope: "transport" },
  { commandId: "transport.previous-frame", label: "Previous frame", key: "ArrowLeft", scope: "transport" },
  { commandId: "transport.next-frame", label: "Next frame", key: "ArrowRight", scope: "transport" },
  {
    commandId: "transport.previous-second",
    label: "Previous second",
    key: "ArrowLeft",
    modifiers: ["Shift"],
    scope: "transport",
  },
  {
    commandId: "transport.next-second",
    label: "Next second",
    key: "ArrowRight",
    modifiers: ["Shift"],
    scope: "transport",
  },
  { commandId: "transport.start", label: "Go to start", key: "Home", scope: "transport" },
  { commandId: "transport.end", label: "Go to end", key: "End", scope: "transport" },
  { commandId: "transport.mark-in", label: "Mark timeline in", key: "i", scope: "transport" },
  { commandId: "transport.mark-out", label: "Mark timeline out", key: "o", scope: "transport" },
  {
    commandId: "transport.loop",
    label: "Toggle timeline loop",
    key: "l",
    modifiers: ["Shift"],
    scope: "transport",
  },
  { commandId: "transport.shuttle-backward", label: "Shuttle backward", key: "j", scope: "transport" },
  { commandId: "transport.shuttle-pause", label: "Pause shuttle", key: "k", scope: "transport" },
  { commandId: "transport.shuttle-forward", label: "Shuttle forward", key: "l", scope: "transport" },
  { commandId: "capture.exact", label: "Capture exact frame", key: "c", scope: "global" },
  { commandId: "history.undo", label: "Undo", key: "z", modifiers: ["Meta"], scope: "global" },
  { commandId: "history.redo", label: "Redo", key: "z", modifiers: ["Meta", "Shift"], scope: "global" },
  {
    commandId: "timeline.nudge-left",
    label: "Nudge selected clips left",
    key: ",",
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "timeline.nudge-right",
    label: "Nudge selected clips right",
    key: ".",
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "timeline.delete",
    label: "Delete selected clips",
    key: "Backspace",
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "timeline.split",
    label: "Split selected clips at playhead",
    key: "b",
    modifiers: ["Meta"],
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "timeline.roll-left",
    label: "Roll boundary left one frame",
    key: "[",
    modifiers: ["Alt"],
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "timeline.roll-right",
    label: "Roll boundary right one frame",
    key: "]",
    modifiers: ["Alt"],
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "timeline.slip-left",
    label: "Slip source left one frame",
    key: ",",
    modifiers: ["Alt"],
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "timeline.slip-right",
    label: "Slip source right one frame",
    key: ".",
    modifiers: ["Alt"],
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "timeline.slide-left",
    label: "Slide clip left one frame",
    key: ",",
    modifiers: ["Shift"],
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "timeline.slide-right",
    label: "Slide clip right one frame",
    key: ".",
    modifiers: ["Shift"],
    scope: "timeline",
    workspaces: ["edit"],
  },
  {
    commandId: "layout.reset",
    label: "Reset workspace layout",
    key: "0",
    modifiers: ["Meta", "Shift"],
    scope: "workspace",
  },
  {
    commandId: "command-palette.open",
    label: "Open command palette",
    key: "k",
    modifiers: ["Meta"],
    scope: "global",
    allowInTextInput: true,
  },
];

export const shortcutSignature = (shortcut: Pick<StudioShortcut, "key" | "modifiers">): string => {
  const modifiers = [...(shortcut.modifiers ?? [])].sort().join("+");
  return modifiers.length === 0 ? shortcut.key.toLowerCase() : `${modifiers}+${shortcut.key.toLowerCase()}`;
};

export const findShortcutConflicts = (shortcuts: readonly StudioShortcut[]): readonly ShortcutConflict[] => {
  const signatures = new Map<string, string[]>();
  for (const shortcut of shortcuts) {
    if (shortcut.enabled === false) continue;
    const signature = shortcutSignature(shortcut);
    const commands = signatures.get(signature) ?? [];
    commands.push(shortcut.commandId);
    signatures.set(signature, commands);
  }
  return [...signatures.entries()]
    .filter(([, commands]) => commands.length > 1)
    .map(([signature, commands]) => ({ signature, commands }));
};

export const shortcutForEvent = (
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target">,
  shortcuts: readonly StudioShortcut[],
  workspace: WorkspaceId,
): StudioShortcut | null => {
  const signature = eventSignature(event);
  const textEntry = isTextEntryTarget(event.target);
  const interactive = isInteractiveTarget(event.target);
  return (
    shortcuts.find(
      (shortcut) =>
        shortcut.enabled !== false &&
        shortcutSignature(shortcut) === signature &&
        (shortcut.workspaces === undefined || shortcut.workspaces.includes(workspace)) &&
        (!interactive || (textEntry && shortcut.allowInTextInput === true)),
    ) ?? null
  );
};

export const formatShortcut = (shortcut: StudioShortcut): string => {
  const macSymbols: Readonly<Record<string, string>> = { Meta: "⌘", Shift: "⇧", Alt: "⌥", Control: "⌃" };
  const modifiers = (shortcut.modifiers ?? []).map((modifier) => macSymbols[modifier] ?? modifier).join("");
  const key =
    shortcut.key === " " ? "Space" : shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  return `${modifiers}${key}`;
};

const eventSignature = (
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): string => {
  const modifiers: ("Alt" | "Control" | "Meta" | "Shift")[] = [];
  if (event.altKey) modifiers.push("Alt");
  if (event.ctrlKey) modifiers.push("Control");
  if (event.metaKey) modifiers.push("Meta");
  if (event.shiftKey) modifiers.push("Shift");
  return shortcutSignature({ key: event.key, modifiers });
};

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return (
    target.closest(
      "button,a[href],input,textarea,select,summary,[contenteditable='true'],[role='button'],[role='tab'],[role='menuitem'],[role='option'],[role='slider'],[role='separator']",
    ) !== null
  );
};
