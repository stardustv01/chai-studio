import type {
  ClipSnapshot,
  StableEntityId,
  TimelinePropertyState,
  TimelinePropertyValue,
  TimelineSnapshotV1,
} from "@chai-studio/timeline/browser";

export type InspectorContextKind =
  | "none"
  | "clip"
  | "clips"
  | "track"
  | "asset"
  | "marker"
  | "keyframe"
  | "transition"
  | "bridge"
  | "caption"
  | "render-output";

export interface InspectorContext {
  readonly kind: InspectorContextKind;
  readonly entityIds: readonly StableEntityId[];
  readonly clipIds: readonly StableEntityId[];
  readonly title: string;
  readonly subtitle: string;
}

export interface InspectorField {
  readonly path: string;
  readonly label: string;
  readonly group: "Transform" | "Timing & audio" | "Composite" | "Remotion native" | "HyperFrames native";
  readonly value: TimelinePropertyValue;
  readonly mixed: boolean;
  readonly state: TimelinePropertyState;
  readonly clipIds: readonly StableEntityId[];
  readonly options: readonly string[];
}

export interface InspectorImpact {
  readonly validation: "valid" | "warning";
  readonly dependencySummary: string;
  readonly cacheSummary: string;
  readonly affectedRange: string;
  readonly warning: string | null;
}

export const resolveInspectorContext = (
  timeline: TimelineSnapshotV1,
  selectedAssetIds: readonly string[] = [],
): InspectorContext => {
  const selected = timeline.selection.selectedIds;
  if (selected.length === 0 && selectedAssetIds.length === 0) return emptyContext;
  const clips = selected.filter((id) => timeline.clips[id] !== undefined);
  if (clips.length === selected.length && clips.length > 0) {
    const firstId = clips[0];
    if (firstId === undefined) return emptyContext;
    const first = timeline.clips[firstId];
    return {
      kind: clips.length === 1 ? "clip" : "clips",
      entityIds: clips,
      clipIds: clips,
      title: clips.length === 1 ? (first?.name ?? "Clip") : `${String(clips.length)} clips`,
      subtitle:
        clips.length === 1 && first !== undefined
          ? `${first.id} · ${timeline.tracks[first.trackId]?.name ?? first.trackId} · ${String(first.range.end - first.range.start)} frames`
          : "Shared safe properties · atomic edit",
    };
  }
  const primary = timeline.selection.primaryId ?? selected[0] ?? null;
  if (primary !== null) {
    const match = contextForEntity(timeline, primary);
    if (match !== null) return match;
  }
  if (selectedAssetIds.length > 0) {
    return {
      kind: "asset",
      entityIds: [],
      clipIds: [],
      title: selectedAssetIds.length === 1 ? "Asset" : `${String(selectedAssetIds.length)} assets`,
      subtitle: selectedAssetIds.join(", "),
    };
  }
  return emptyContext;
};

export const inspectorFields = (
  timeline: TimelineSnapshotV1,
  context: InspectorContext,
): readonly InspectorField[] => {
  if (context.clipIds.length === 0) return [];
  const clips = context.clipIds.map((id) => timeline.clips[id]).filter(isClip);
  const first = clips[0];
  if (first?.properties === undefined) return [];
  return Object.keys(first.properties)
    .filter((path) => clips.every((clip) => clip.properties?.[path] !== undefined))
    .filter((path) =>
      clips.length === 1
        ? true
        : clips.every((clip) => {
            const state = clip.properties?.[path];
            return state?.safeToEdit === true && state.ownership === "shared";
          }),
    )
    .sort(fieldOrder)
    .map((path) => {
      const states = clips.map((clip) => clip.properties?.[path]).filter(isPropertyState);
      const state = states[0];
      if (state === undefined) throw new Error(`Missing inspector property state for ${path}.`);
      const values = states.map((item) => item.value);
      return {
        path,
        label: propertyLabel(path),
        group: propertyGroup(path),
        value: state.value,
        mixed: values.slice(1).some((value) => !propertyValuesEqual(values[0], value)),
        state,
        clipIds: context.clipIds,
        options: propertyOptions(path),
      };
    });
};

export const parseInspectorDraft = (
  field: InspectorField,
  draft: string,
): Readonly<{ ok: true; value: TimelinePropertyValue }> | Readonly<{ ok: false; message: string }> => {
  const trimmed = draft.trim();
  if (field.state.unit === "boolean") {
    if (trimmed === "true") return { ok: true, value: true };
    if (trimmed === "false") return { ok: true, value: false };
    return { ok: false, message: "Choose true or false." };
  }
  if (Array.isArray(field.value)) {
    const values = trimmed.split(",").map((part) => part.trim());
    if (values.length !== field.value.length || values.some((value) => !strictNumber.test(value))) {
      return { ok: false, message: `Enter ${String(field.value.length)} comma-separated numbers.` };
    }
    const parsed = values.map(Number);
    const invalid = parsed.find((value) => !numberWithinBounds(field.state, value));
    return invalid === undefined
      ? { ok: true, value: parsed }
      : { ok: false, message: boundsMessage(field.state) };
  }
  if (typeof field.value === "number") {
    if (!strictNumber.test(trimmed))
      return { ok: false, message: "Enter a number; expressions are not allowed." };
    const parsed = Number(trimmed);
    return numberWithinBounds(field.state, parsed)
      ? { ok: true, value: parsed }
      : { ok: false, message: boundsMessage(field.state) };
  }
  if (field.state.unit === "color" && !/^#[\dA-Fa-f]{6}([\dA-Fa-f]{2})?$/.test(trimmed)) {
    return { ok: false, message: "Use a six- or eight-digit hex color." };
  }
  if (field.state.unit === "enum" && field.options.length > 0 && !field.options.includes(trimmed)) {
    return { ok: false, message: "Choose one of the supported values." };
  }
  if (trimmed.length === 0 && field.state.unit === "file")
    return { ok: false, message: "Choose a project file." };
  return { ok: true, value: draft };
};

export const inspectorImpact = (timeline: TimelineSnapshotV1, context: InspectorContext): InspectorImpact => {
  const clips = context.clipIds.map((id) => timeline.clips[id]).filter(isClip);
  if (clips.length === 0) {
    return {
      validation: "valid",
      dependencySummary: "No clip dependencies",
      cacheSummary: "No cache affected",
      affectedRange: "No render range",
      warning: null,
    };
  }
  const start = clips.reduce(
    (value, clip) => (clip.range.start < value ? clip.range.start : value),
    clips[0]?.range.start ?? 0n,
  );
  const end = clips.reduce(
    (value, clip) => (clip.range.end > value ? clip.range.end : value),
    clips[0]?.range.end ?? 0n,
  );
  const warnings = clips
    .map((clip) => clip.metadata.warning)
    .filter((item): item is string => item !== undefined);
  const blockingWarnings = warnings.filter((warning) => warning !== "preview-baked");
  const dependencies = [...new Set(clips.map((clip) => clip.metadata.dependencies).filter(Boolean))];
  const caches = [...new Set(clips.map((clip) => clip.metadata.cache ?? "uncached"))];
  return {
    validation: blockingWarnings.length === 0 ? "valid" : "warning",
    dependencySummary: dependencies.length === 0 ? "Dependencies resolved" : dependencies.join(" · "),
    cacheSummary: caches.join(" · "),
    affectedRange: `${String(start)}–${String(end)} · ${String(end - start)} frames`,
    warning:
      warnings[0] === "preview-baked"
        ? "Baked preview in use. Playback is available through a pre-rendered proxy; final rendering is not blocked."
        : (warnings[0] ?? null),
  };
};

export const fieldDraftValue = (field: InspectorField): string =>
  field.mixed ? "" : Array.isArray(field.value) ? field.value.join(", ") : String(field.value);

const contextForEntity = (timeline: TimelineSnapshotV1, id: StableEntityId): InspectorContext | null => {
  const entities = [
    [timeline.tracks[id], "track"],
    [timeline.markers[id], "marker"],
    [timeline.keyframes[id], "keyframe"],
    [timeline.transitions[id], "transition"],
    [timeline.bridges[id], "bridge"],
    [timeline.captions[id], "caption"],
  ] as const;
  for (const [entity, kind] of entities) {
    if (entity !== undefined) {
      const name = "name" in entity ? entity.name : "label" in entity ? entity.label : kind;
      return { kind, entityIds: [id], clipIds: [], title: name, subtitle: id };
    }
  }
  return null;
};

const propertyGroup = (path: string): InspectorField["group"] =>
  path.startsWith("native.remotion.")
    ? "Remotion native"
    : path.startsWith("native.hyperframes.")
      ? "HyperFrames native"
      : path.startsWith("transform.")
        ? "Transform"
        : path.startsWith("composite.")
          ? "Composite"
          : "Timing & audio";

const propertyLabel = (path: string): string => {
  const value = path.split(".").at(-1) ?? path;
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
};

const propertyOptions = (path: string): readonly string[] =>
  path === "composite.blendMode"
    ? ["normal", "multiply", "screen", "overlay", "darken", "lighten"]
    : path === "native.remotion.theme"
      ? ["Midnight", "Daylight", "Ember"]
      : [];

const fieldOrder = (left: string, right: string): number => {
  const exact = [
    "transform.position",
    "transform.scale",
    "transform.rotation",
    "transform.anchor",
    "transform.opacity",
    "transform.crop",
    "time.speed",
    "audio.volume",
    "audio.fadeIn",
    "audio.fadeOut",
    "composite.blendMode",
  ];
  const leftExact = exact.indexOf(left);
  const rightExact = exact.indexOf(right);
  if (leftExact >= 0 || rightExact >= 0) {
    return (leftExact < 0 ? exact.length : leftExact) - (rightExact < 0 ? exact.length : rightExact);
  }
  const group = (value: string): number =>
    value.startsWith("transform.")
      ? 0
      : value.startsWith("time.") || value.startsWith("audio.")
        ? 1
        : value.startsWith("composite.")
          ? 2
          : value.startsWith("native.remotion.")
            ? 3
            : 4;
  return group(left) - group(right) || left.localeCompare(right, "en");
};

const numberWithinBounds = (state: TimelinePropertyState, value: number): boolean =>
  Number.isFinite(value) &&
  (state.minimum === null || value >= state.minimum) &&
  (state.maximum === null || value <= state.maximum);

const boundsMessage = (state: TimelinePropertyState): string =>
  `Use a value${state.minimum === null ? "" : ` ≥ ${String(state.minimum)}`}${state.maximum === null ? "" : ` ≤ ${String(state.maximum)}`}.`;

const propertyValuesEqual = (
  left: TimelinePropertyValue | undefined,
  right: TimelinePropertyValue,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const isClip = (value: ClipSnapshot | undefined): value is ClipSnapshot => value !== undefined;
const isPropertyState = (value: TimelinePropertyState | undefined): value is TimelinePropertyState =>
  value !== undefined;
const strictNumber = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
const emptyContext: InspectorContext = {
  kind: "none",
  entityIds: [],
  clipIds: [],
  title: "Nothing selected",
  subtitle: "Select a timeline item to inspect it.",
};
