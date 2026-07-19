import type { FrameRange, MasterFrame } from "./range.js";
import { stableEntityId, type StableEntityId, type TimelineSnapshotV1 } from "./model.js";
import { assertValidTimelineCore } from "./validation.js";

export type TimelineEntityKind =
  | "timeline"
  | "track"
  | "audio-bus"
  | "clip"
  | "nested-sequence"
  | "keyframe"
  | "marker"
  | "transition"
  | "bridge"
  | "caption"
  | "automation-lane";

export interface ClipIntervalIndexEntry {
  readonly clipId: StableEntityId;
  readonly trackId: StableEntityId;
  readonly start: MasterFrame;
  readonly end: MasterFrame;
}

export interface TranscriptPhraseIndexSource {
  readonly id: StableEntityId;
  readonly clipId: StableEntityId;
  readonly range: FrameRange;
  readonly text: string;
}

export interface RenderDependencyIndexSource {
  readonly entityId: StableEntityId;
  readonly dependencyIds: readonly StableEntityId[];
}

export interface TimelineDerivedIndexSources {
  readonly transcriptPhrases?: readonly TranscriptPhraseIndexSource[];
  readonly renderDependencies?: readonly RenderDependencyIndexSource[];
}

export interface TimelineDerivedIndexes {
  readonly sourceRevisionId: StableEntityId;
  readonly clipsInTimelineOrder: readonly StableEntityId[];
  readonly clipIntervals: readonly ClipIntervalIndexEntry[];
  readonly clipsByTrack: Readonly<Record<StableEntityId, readonly StableEntityId[]>>;
  readonly clipsByAsset: Readonly<Record<StableEntityId, readonly StableEntityId[]>>;
  readonly clipsByNestedSequence: Readonly<Record<StableEntityId, readonly StableEntityId[]>>;
  readonly clipsByLinkGroup: Readonly<Record<StableEntityId, readonly StableEntityId[]>>;
  readonly clipsBySelectionGroup: Readonly<Record<StableEntityId, readonly StableEntityId[]>>;
  readonly keyframesByOwnerProperty: Readonly<Record<string, readonly StableEntityId[]>>;
  readonly transcriptPhraseIdsByClip: Readonly<Record<StableEntityId, readonly StableEntityId[]>>;
  readonly transcriptPhraseIntervals: readonly Readonly<TranscriptPhraseIndexSource>[];
  readonly renderDependenciesByEntity: Readonly<Record<StableEntityId, readonly StableEntityId[]>>;
  readonly renderDependentsByEntity: Readonly<Record<StableEntityId, readonly StableEntityId[]>>;
  readonly searchTextByEntity: Readonly<Record<StableEntityId, string>>;
  readonly markersInFrameOrder: readonly StableEntityId[];
  readonly entityKindById: Readonly<Record<StableEntityId, TimelineEntityKind>>;
}

export class TimelineDerivedIndexCache {
  #cache = new WeakMap<TimelineSnapshotV1, TimelineDerivedIndexes>();
  #hits = 0;
  #misses = 0;

  get(timeline: TimelineSnapshotV1): TimelineDerivedIndexes {
    const cached = this.#cache.get(timeline);
    if (cached !== undefined) {
      this.#hits += 1;
      return cached;
    }
    const indexes = buildTimelineDerivedIndexes(timeline);
    this.#cache.set(timeline, indexes);
    this.#misses += 1;
    return indexes;
  }

  clear(): void {
    this.#cache = new WeakMap();
    this.#hits = 0;
    this.#misses = 0;
  }

  snapshot(): Readonly<{ hits: number; misses: number; hitRate: number }> {
    const total = this.#hits + this.#misses;
    return { hits: this.#hits, misses: this.#misses, hitRate: total === 0 ? 0 : this.#hits / total };
  }
}

export const ownerPropertyIndexKey = (ownerId: StableEntityId, propertyPath: string): string =>
  `${ownerId}\u0000${propertyPath}`;

export const buildTimelineDerivedIndexes = (
  timeline: TimelineSnapshotV1,
  sources: TimelineDerivedIndexSources = {},
): TimelineDerivedIndexes => {
  assertValidTimelineCore(timeline);
  const trackOrder = new Map(timeline.trackIds.map((id, index) => [id, index]));
  const orderedClips = Object.values(timeline.clips).sort((left, right) => {
    const trackDelta =
      (trackOrder.get(left.trackId) ?? Number.MAX_SAFE_INTEGER) -
      (trackOrder.get(right.trackId) ?? Number.MAX_SAFE_INTEGER);
    if (trackDelta !== 0) return trackDelta;
    return compareFrameThenId(left.range.start, left.id, right.range.start, right.id);
  });
  const keyframes = Object.values(timeline.keyframes).sort((left, right) =>
    compareFrameThenId(left.frame, left.id, right.frame, right.id),
  );
  const markers = Object.values(timeline.markers).sort((left, right) =>
    compareFrameThenId(left.frame, left.id, right.frame, right.id),
  );
  const transcriptPhrases = [...(sources.transcriptPhrases ?? [])].sort((left, right) =>
    compareFrameThenId(left.range.start, left.id, right.range.start, right.id),
  );
  const renderDependencies = [...(sources.renderDependencies ?? [])].sort((left, right) =>
    left.entityId.localeCompare(right.entityId, "en"),
  );

  return {
    sourceRevisionId: timeline.revisionId,
    clipsInTimelineOrder: orderedClips.map((clip) => clip.id),
    clipIntervals: orderedClips.map((clip) => ({
      clipId: clip.id,
      trackId: clip.trackId,
      start: clip.range.start,
      end: clip.range.end,
    })),
    clipsByTrack: groupIds(orderedClips, (clip) => clip.trackId),
    clipsByAsset: groupIds(
      orderedClips.filter((clip) => clip.assetId !== null),
      (clip) => requireIndexId(clip.assetId),
    ),
    clipsByNestedSequence: groupIds(
      orderedClips.filter((clip) => clip.nestedSequenceId !== null),
      (clip) => requireIndexId(clip.nestedSequenceId),
    ),
    clipsByLinkGroup: groupIds(
      orderedClips.filter((clip) => clip.linkGroupId !== null),
      (clip) => requireIndexId(clip.linkGroupId),
    ),
    clipsBySelectionGroup: groupIds(
      orderedClips.filter((clip) => clip.selectionGroupId !== null),
      (clip) => requireIndexId(clip.selectionGroupId),
    ),
    keyframesByOwnerProperty: groupIds(keyframes, (keyframe) =>
      ownerPropertyIndexKey(keyframe.ownerEntityId, keyframe.propertyPath),
    ),
    transcriptPhraseIdsByClip: groupIds(transcriptPhrases, (phrase) => phrase.clipId),
    transcriptPhraseIntervals: transcriptPhrases,
    renderDependenciesByEntity: Object.fromEntries(
      renderDependencies.map((entry) => [entry.entityId, sortedUniqueIds(entry.dependencyIds)]),
    ),
    renderDependentsByEntity: reverseDependencies(renderDependencies),
    searchTextByEntity: buildSearchTextIndex(timeline, transcriptPhrases),
    markersInFrameOrder: markers.map((marker) => marker.id),
    entityKindById: buildEntityKindIndex(timeline),
  };
};

export const queryClipsAtFrame = (
  indexes: TimelineDerivedIndexes,
  frame: MasterFrame,
  trackId?: StableEntityId,
): readonly StableEntityId[] =>
  indexes.clipIntervals
    .filter(
      (entry) =>
        (trackId === undefined || entry.trackId === trackId) && entry.start <= frame && frame < entry.end,
    )
    .map((entry) => entry.clipId);

export const queryClipsOverlappingRange = (
  indexes: TimelineDerivedIndexes,
  range: FrameRange,
  trackId?: StableEntityId,
): readonly StableEntityId[] =>
  indexes.clipIntervals
    .filter(
      (entry) =>
        (trackId === undefined || entry.trackId === trackId) &&
        entry.start < range.end &&
        range.start < entry.end,
    )
    .map((entry) => entry.clipId);

export const queryVisibleClipsOverlappingRange = (
  timeline: TimelineSnapshotV1,
  indexes: TimelineDerivedIndexes,
  range: FrameRange,
): readonly StableEntityId[] =>
  queryClipsOverlappingRange(indexes, range).filter((id) => {
    const clip = timeline.clips[id];
    return clip !== undefined && timeline.tracks[clip.trackId]?.hidden === false;
  });

export const queryActiveVisualLayers = (
  timeline: TimelineSnapshotV1,
  indexes: TimelineDerivedIndexes,
  frame: MasterFrame,
): readonly StableEntityId[] => {
  const trackOrder = new Map(timeline.trackIds.map((id, index) => [id, index]));
  return queryClipsAtFrame(indexes, frame)
    .filter((id) => {
      const clip = timeline.clips[id];
      const track = clip === undefined ? undefined : timeline.tracks[clip.trackId];
      return track?.kind === "video" && !track.hidden;
    })
    .sort((leftId, rightId) => {
      const left = timeline.clips[leftId];
      const right = timeline.clips[rightId];
      if (left === undefined || right === undefined) return leftId.localeCompare(rightId, "en");
      return (trackOrder.get(right.trackId) ?? -1) - (trackOrder.get(left.trackId) ?? -1);
    });
};

export const queryNearbyClips = (
  indexes: TimelineDerivedIndexes,
  frame: MasterFrame,
  beforeCount: number,
  afterCount: number,
): readonly StableEntityId[] => {
  const before = indexes.clipIntervals
    .filter((entry) => entry.end <= frame)
    .sort((left, right) => (left.end > right.end ? -1 : left.end < right.end ? 1 : 0))
    .slice(0, Math.max(0, beforeCount))
    .reverse();
  const active = indexes.clipIntervals.filter((entry) => entry.start <= frame && frame < entry.end);
  const after = indexes.clipIntervals
    .filter((entry) => entry.start > frame)
    .sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0))
    .slice(0, Math.max(0, afterCount));
  return [...before, ...active, ...after].map((entry) => entry.clipId);
};

export const searchTimelineIndex = (
  indexes: TimelineDerivedIndexes,
  query: string,
  limit = 100,
): readonly StableEntityId[] => {
  const terms = normalizeSearchText(query)
    .split(" ")
    .filter((term) => term.length > 0);
  if (terms.length === 0 || limit <= 0) return [];
  return Object.entries(indexes.searchTextByEntity)
    .filter(([, text]) => terms.every((term) => text.includes(term)))
    .map(([id]) => stableEntityId(id))
    .sort((left, right) => left.localeCompare(right, "en"))
    .slice(0, limit);
};

const groupIds = <T extends { readonly id: StableEntityId }>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Readonly<Record<string, readonly StableEntityId[]>> => {
  const grouped: Record<string, StableEntityId[]> = {};
  for (const value of values) (grouped[keyFor(value)] ??= []).push(value.id);
  return grouped;
};

const compareFrameThenId = (
  leftFrame: MasterFrame,
  leftId: StableEntityId,
  rightFrame: MasterFrame,
  rightId: StableEntityId,
): number => (leftFrame < rightFrame ? -1 : leftFrame > rightFrame ? 1 : leftId.localeCompare(rightId, "en"));

const buildEntityKindIndex = (
  timeline: TimelineSnapshotV1,
): Readonly<Record<StableEntityId, TimelineEntityKind>> => {
  const result: Record<StableEntityId, TimelineEntityKind> = { [timeline.id]: "timeline" };
  addKinds(result, timeline.tracks, "track");
  addKinds(result, timeline.audioBuses, "audio-bus");
  addKinds(result, timeline.clips, "clip");
  addKinds(result, timeline.nestedSequences, "nested-sequence");
  addKinds(result, timeline.keyframes, "keyframe");
  addKinds(result, timeline.markers, "marker");
  addKinds(result, timeline.transitions, "transition");
  addKinds(result, timeline.bridges, "bridge");
  addKinds(result, timeline.captions, "caption");
  addKinds(result, timeline.automation, "automation-lane");
  return result;
};

const addKinds = <T>(
  target: Record<StableEntityId, TimelineEntityKind>,
  records: Readonly<Record<StableEntityId, T>>,
  kind: TimelineEntityKind,
): void => {
  for (const id of Object.keys(records) as StableEntityId[]) target[id] = kind;
};

const sortedUniqueIds = (ids: readonly StableEntityId[]): readonly StableEntityId[] =>
  [...new Set(ids)].sort((left, right) => left.localeCompare(right, "en"));

const reverseDependencies = (
  sources: readonly RenderDependencyIndexSource[],
): Readonly<Record<StableEntityId, readonly StableEntityId[]>> => {
  const reversed: Record<StableEntityId, StableEntityId[]> = {};
  for (const source of sources) {
    for (const dependencyId of source.dependencyIds) {
      (reversed[dependencyId] ??= []).push(source.entityId);
    }
  }
  return Object.fromEntries(
    Object.entries(reversed).map(([id, dependents]) => [id, sortedUniqueIds(dependents)]),
  );
};

const buildSearchTextIndex = (
  timeline: TimelineSnapshotV1,
  phrases: readonly TranscriptPhraseIndexSource[],
): Readonly<Record<StableEntityId, string>> => {
  const entries: (readonly [StableEntityId, string])[] = [];
  for (const clip of Object.values(timeline.clips)) {
    entries.push([
      clip.id,
      normalizeSearchText(
        [
          clip.name,
          clip.assetId ?? "",
          clip.nestedSequenceId ?? "",
          clip.engine,
          ...Object.keys(clip.metadata),
          ...Object.values(clip.metadata),
        ].join(" "),
      ),
    ]);
  }
  for (const marker of Object.values(timeline.markers)) {
    entries.push([
      marker.id,
      normalizeSearchText(`${marker.label} ${marker.category} ${marker.issueSeverity ?? ""}`),
    ]);
  }
  for (const phrase of phrases) entries.push([phrase.id, normalizeSearchText(phrase.text)]);
  return Object.fromEntries(entries);
};

const normalizeSearchText = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();

const requireIndexId = (value: StableEntityId | null): StableEntityId => {
  if (value === null) throw new Error("Derived index received a null key after filtering.");
  return value;
};
