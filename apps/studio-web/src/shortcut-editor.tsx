import { useMemo, useRef, useState } from "react";
import { Badge, Button, IconButton, Notice } from "@chai-studio/ui-components";
import {
  conflictsForProfile,
  defaultShortcutProfile,
  exportShortcutProfile,
  importShortcutProfile,
  updateShortcutBinding,
  type ShortcutBinding,
  type ShortcutProfile,
} from "./shortcut-profile.js";
import { applyShortcutProfile } from "./shortcut-profile.js";
import { formatShortcut } from "./shortcuts.js";
import { ModalDialog } from "./modal-dialog.js";

export const ShortcutEditor = ({
  onApply,
  onClose,
  profile,
}: {
  readonly onApply: (profile: ShortcutProfile) => void;
  readonly onClose: () => void;
  readonly profile: ShortcutProfile;
}) => {
  const [draft, setDraft] = useState(profile);
  const [query, setQuery] = useState("");
  const [transfer, setTransfer] = useState("");
  const [status, setStatus] = useState("Ready to customize. Core commands remain searchable.");
  const searchRef = useRef<HTMLInputElement>(null);
  const shortcuts = useMemo(() => applyShortcutProfile(draft), [draft]);
  const visible = shortcuts.filter((shortcut) =>
    `${shortcut.label} ${shortcut.commandId}`.toLowerCase().includes(query.toLowerCase()),
  );
  const conflicts = conflictsForProfile(draft);
  const update = (binding: ShortcutBinding, resolve: boolean): void => {
    try {
      const next = updateShortcutBinding(draft, binding, resolve ? "disable-conflicts" : "reject");
      setDraft(next);
      setStatus(resolve ? "Binding saved; conflicting commands were disabled." : "Binding saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Binding rejected.");
    }
  };
  return (
    <ModalDialog
      className="shortcut-editor"
      labelledBy="shortcut-title"
      initialFocusRef={searchRef}
      onDismiss={onClose}
    >
      <div className="dialog-title">
        <div>
          <span>Keyboard accessibility</span>
          <h2 id="shortcut-title">Shortcut editor</h2>
        </div>
        <IconButton label="Close shortcut editor" onClick={onClose}>
          ×
        </IconButton>
      </div>
      <label className="palette-search">
        <span>⌘</span>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
        />
        <Badge tone={conflicts.length === 0 ? "ready" : "danger"}>{conflicts.length} conflicts</Badge>
      </label>
      <Notice title="Conflict-safe customization" tone={conflicts.length === 0 ? "ready" : "danger"}>
        {status}
      </Notice>
      <div className="shortcut-list">
        {visible.map((shortcut) => {
          const binding = draft.bindings.find((item) => item.commandId === shortcut.commandId);
          if (binding === undefined) return null;
          return (
            <ShortcutBindingRow
              key={shortcut.commandId}
              binding={binding}
              label={shortcut.label}
              onUpdate={update}
            />
          );
        })}
      </div>
      <label className="shortcut-transfer">
        <span>Import / export JSON</span>
        <textarea
          value={transfer}
          onChange={(event) => {
            setTransfer(event.target.value);
          }}
        />
      </label>
      <footer>
        <Button
          onClick={() => {
            setTransfer(exportShortcutProfile(draft));
          }}
        >
          Export current
        </Button>
        <Button
          onClick={() => {
            try {
              setDraft(importShortcutProfile(transfer));
              setStatus("Imported shortcut profile validated.");
            } catch (error) {
              setStatus(error instanceof Error ? error.message : "Import failed.");
            }
          }}
        >
          Import JSON
        </Button>
        <Button
          onClick={() => {
            setDraft(defaultShortcutProfile());
            setStatus("Default shortcuts restored in the draft.");
          }}
        >
          Reset defaults
        </Button>
        <Button
          variant="primary"
          disabled={conflicts.length > 0}
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Apply profile
        </Button>
      </footer>
    </ModalDialog>
  );
};

const ShortcutBindingRow = ({
  binding,
  label,
  onUpdate,
}: {
  readonly binding: ShortcutBinding;
  readonly label: string;
  readonly onUpdate: (binding: ShortcutBinding, resolve: boolean) => void;
}) => {
  const [key, setKey] = useState(binding.key);
  const [modifiers, setModifiers] = useState(binding.modifiers);
  const next = { ...binding, key, modifiers };
  return (
    <article>
      <span>
        <strong>{label}</strong>
        <small>{binding.commandId}</small>
      </span>
      <code>
        {formatShortcut({
          ...next,
          label,
          scope: "global",
        })}
      </code>
      <input
        value={key}
        aria-label={`${label} key`}
        onChange={(event) => {
          setKey(event.target.value);
        }}
      />
      {(["Meta", "Shift", "Alt", "Control"] as const).map((modifier) => (
        <label key={modifier}>
          <input
            type="checkbox"
            checked={modifiers.includes(modifier)}
            onChange={(event) => {
              setModifiers(
                event.target.checked
                  ? [...modifiers, modifier]
                  : modifiers.filter((value) => value !== modifier),
              );
            }}
          />
          {modifier}
        </label>
      ))}
      <Button
        onClick={() => {
          onUpdate(next, false);
        }}
      >
        Save
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          onUpdate(next, true);
        }}
      >
        Resolve
      </Button>
    </article>
  );
};
