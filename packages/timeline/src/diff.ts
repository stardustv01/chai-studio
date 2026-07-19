import type { StableEntityId, TimelineSnapshotV1 } from "./model.js";
import type { TimelineEntityKind } from "./derived-indexes.js";

export type TimelineChangeKind = "added" | "removed" | "modified";

export interface TimelineEntityChange {
  readonly entityId: StableEntityId;
  readonly entityKind: TimelineEntityKind;
  readonly change: TimelineChangeKind;
  readonly fields: readonly string[];
}

export interface TimelineSnapshotDiff {
  readonly beforeRevisionId: StableEntityId;
  readonly afterRevisionId: StableEntityId;
  readonly changes: readonly TimelineEntityChange[];
  readonly addedCount: number;
  readonly removedCount: number;
  readonly modifiedCount: number;
  readonly summary: string;
}

export const diffTimelineSnapshots = (
  before: TimelineSnapshotV1,
  after: TimelineSnapshotV1,
): TimelineSnapshotDiff => {
  if (before === after) return emptyTimelineDiff(before.revisionId, after.revisionId);
  const changes: TimelineEntityChange[] = [];
  const timelineFields = changedFields(before, after, [
    "projectId",
    "revisionId",
    "name",
    "fps",
    "duration",
    "trackIds",
    "audioBusIds",
    "selection",
    "inOutRange",
    "professionalMetadata",
  ]);
  if (timelineFields.length > 0) {
    changes.push({ entityId: after.id, entityKind: "timeline", change: "modified", fields: timelineFields });
  }
  compareRegistry(changes, "track", before.tracks, after.tracks);
  compareRegistry(changes, "audio-bus", before.audioBuses, after.audioBuses);
  compareRegistry(changes, "clip", before.clips, after.clips);
  compareRegistry(changes, "nested-sequence", before.nestedSequences, after.nestedSequences);
  compareRegistry(changes, "keyframe", before.keyframes, after.keyframes);
  compareRegistry(changes, "marker", before.markers, after.markers);
  compareRegistry(changes, "transition", before.transitions, after.transitions);
  compareRegistry(changes, "bridge", before.bridges, after.bridges);
  compareRegistry(changes, "caption", before.captions, after.captions);
  compareRegistry(changes, "automation-lane", before.automation, after.automation);
  changes.sort(
    (left, right) =>
      left.entityKind.localeCompare(right.entityKind, "en") ||
      left.entityId.localeCompare(right.entityId, "en"),
  );
  const addedCount = changes.filter((item) => item.change === "added").length;
  const removedCount = changes.filter((item) => item.change === "removed").length;
  const modifiedCount = changes.filter((item) => item.change === "modified").length;
  return {
    beforeRevisionId: before.revisionId,
    afterRevisionId: after.revisionId,
    changes,
    addedCount,
    removedCount,
    modifiedCount,
    summary: `${String(addedCount)} added, ${String(removedCount)} removed, ${String(modifiedCount)} modified`,
  };
};

const compareRegistry = <T extends { readonly id: StableEntityId }>(
  changes: TimelineEntityChange[],
  entityKind: TimelineEntityKind,
  before: Readonly<Record<StableEntityId, T>>,
  after: Readonly<Record<StableEntityId, T>>,
): void => {
  if (before === after) return;
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((left, right) =>
    left.localeCompare(right, "en"),
  ) as StableEntityId[];
  for (const id of ids) {
    const prior = before[id];
    const next = after[id];
    if (prior === undefined && next !== undefined) {
      changes.push({ entityId: id, entityKind, change: "added", fields: Object.keys(next).sort() });
    } else if (prior !== undefined && next === undefined) {
      changes.push({ entityId: id, entityKind, change: "removed", fields: Object.keys(prior).sort() });
    } else if (prior !== undefined && next !== undefined) {
      const fields = changedFields(prior, next, [...new Set([...Object.keys(prior), ...Object.keys(next)])]);
      if (fields.length > 0) changes.push({ entityId: id, entityKind, change: "modified", fields });
    }
  }
};

const changedFields = (before: object, after: object, fields: readonly string[]): readonly string[] => {
  if (before === after) return [];
  const prior = before as Readonly<Record<string, unknown>>;
  const next = after as Readonly<Record<string, unknown>>;
  return fields
    .filter((field) => stableComparable(prior[field]) !== stableComparable(next[field]))
    .sort((left, right) => left.localeCompare(right, "en"));
};

const emptyTimelineDiff = (
  beforeRevisionId: StableEntityId,
  afterRevisionId: StableEntityId,
): TimelineSnapshotDiff => ({
  beforeRevisionId,
  afterRevisionId,
  changes: [],
  addedCount: 0,
  removedCount: 0,
  modifiedCount: 0,
  summary: "0 added, 0 removed, 0 modified",
});

const stableComparable = (value: unknown): string => {
  if (typeof value === "bigint") return `bigint:${String(value)}`;
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableComparable).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => `${key}:${stableComparable(record[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "string") return `string:${value}`;
  if (typeof value === "number") return `number:${String(value)}`;
  if (typeof value === "boolean") return `boolean:${value ? "true" : "false"}`;
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "symbol") return `symbol:${value.description ?? ""}`;
  return "function";
};
