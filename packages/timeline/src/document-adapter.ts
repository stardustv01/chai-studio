import type { JsonValue, TimelineDocument } from "@chai-studio/schema";
import { normalizeRational, serializeBigInt } from "@chai-studio/schema/rational";
import { executeTimelineCommand, type TimelineEditCommand } from "./commands.js";
import {
  stableEntityId,
  type AutomationLaneSnapshot,
  type AudioBusSnapshot,
  type ClipSnapshot,
  type KeyframeSnapshot,
  type MarkerSnapshot,
  type StableEntityId,
  type TimelineSnapshotV1,
  type TrackSnapshot,
} from "./model.js";
import { createFrameRange, masterFrame } from "./range.js";
import { assertValidTimelineCore } from "./validation.js";

const supportedOperationKinds = new Set([
  "selection.set",
  "clips.move",
  "clips.move-to-new-track",
  "clip.insert",
  "clip.overwrite",
  "clip.replace",
  "clips.duplicate",
  "clips.paste",
  "clips.group",
  "clips.link",
  "clips.split",
  "clips.trim",
  "clips.lift",
  "clips.delete",
  "clips.ripple-delete",
  "range.set",
  "range.clear",
  "track.add",
  "track.update",
  "track.remove",
  "tracks.reorder",
  "clip.update",
  "clips.properties.update",
  "clips.properties.convert-to-shared",
  "marker.add",
  "marker.update",
  "markers.remove",
  "automation-lane.add",
  "automation-lanes.remove",
  "keyframe.add",
  "keyframes.add",
  "keyframe.update",
  "keyframes.update",
  "keyframes.remove",
  "clips.roll",
  "clip.slip",
  "clip.slide",
  "compound.create",
  "compound.flatten",
  "takes.set",
  "take.activate",
  "clip.playback",
  "clip.speed",
  "clip.time-remap",
  "adjustment.upsert",
  "adjustment.remove",
  "bridge.advanced.upsert",
  "bridge.advanced.remove",
] as const);

const bigintKeys = new Set([
  "start",
  "end",
  "duration",
  "frame",
  "origin",
  "delta",
  "atFrame",
  "toFrame",
  "boundary",
  "deltaTimelineFrames",
  "freezeSourceFrame",
  "timelineFrame",
  "sourceFrame",
  "outgoingHandleFrames",
  "incomingHandleFrames",
  "preRollFrames",
  "postRollFrames",
]);

export interface TimelineDocumentEditResult {
  readonly timeline: TimelineDocument;
  readonly label: string;
  readonly diffSummary: string;
  readonly affectedEntityIds: readonly string[];
  readonly warnings: readonly string[];
}

export const timelineDocumentToSnapshot = (document: TimelineDocument): TimelineSnapshotV1 => {
  const keyframes = Object.fromEntries(
    (document.keyframes ?? []).map((keyframe) => {
      const id = stableEntityId(keyframe.id);
      const value: KeyframeSnapshot = {
        ...keyframe,
        id,
        ownerEntityId: stableEntityId(keyframe.ownerEntityId),
        frame: masterFrame(BigInt(keyframe.frame)),
      };
      return [id, value];
    }),
  ) as Record<StableEntityId, KeyframeSnapshot>;
  const trackIds = document.tracks
    .slice()
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, "en"))
    .map((track) => stableEntityId(track.id));
  const tracks = Object.fromEntries(
    document.tracks.map((track) => {
      const id = stableEntityId(track.id);
      const audioBusId = track.clips.find((clip) => clip.audioBusId !== null)?.audioBusId ?? null;
      const value: TrackSnapshot = {
        id,
        kind: track.kind,
        name: track.name,
        order: track.order,
        locked: track.locked,
        hidden: track.hidden,
        muted: track.muted,
        solo: track.solo,
        audioBusId: audioBusId === null ? null : stableEntityId(audioBusId),
        clipIds: track.clips.map((clip) => stableEntityId(clip.id)),
      };
      return [id, value];
    }),
  ) as Record<StableEntityId, TrackSnapshot>;
  const clips = Object.fromEntries(
    document.tracks.flatMap((track) =>
      track.clips.map((clip) => {
        const start = masterFrame(BigInt(clip.startFrame));
        const duration = masterFrame(BigInt(clip.durationFrames));
        const sourceStart = masterFrame(BigInt(clip.sourceInFrame));
        const sourceDuration = masterFrame(BigInt(clip.sourceDurationFrames));
        const id = stableEntityId(clip.id);
        const value: ClipSnapshot = {
          id,
          trackId: stableEntityId(track.id),
          assetId: clip.assetId === null ? null : stableEntityId(clip.assetId),
          nestedSequenceId: null,
          engine: clip.engine,
          name: clip.name ?? clip.assetId ?? clip.id,
          range: createFrameRange(start, masterFrame(start + duration)),
          sourceRange: createFrameRange(sourceStart, masterFrame(sourceStart + sourceDuration)),
          sourceRate: document.fps,
          speed: normalizeRational(1n, 1n),
          availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(sourceStart + sourceDuration)),
          linkGroupId: clip.linkGroupId == null ? null : stableEntityId(clip.linkGroupId),
          selectionGroupId: clip.selectionGroupId == null ? null : stableEntityId(clip.selectionGroupId),
          transitionInId: null,
          transitionOutId: null,
          keyframeIds: Object.values(keyframes)
            .filter((keyframe) => keyframe.ownerEntityId === id)
            .map((keyframe) => keyframe.id),
          metadata: { capability: clip.capability, ...(clip.metadata ?? {}) },
          ...(clip.properties === undefined ? {} : { properties: clip.properties }),
        };
        return [id, value];
      }),
    ),
  ) as Record<StableEntityId, ClipSnapshot>;
  const audioBusIds = document.audioBusIds.map((id) => stableEntityId(id));
  const audioBuses = Object.fromEntries(
    audioBusIds.map((id, order) => {
      const value: AudioBusSnapshot = {
        id,
        name: order === 0 ? "Master" : `Bus ${String(order + 1)}`,
        order,
        muted: false,
        solo: false,
        gain: 1,
      };
      return [id, value];
    }),
  ) as Record<StableEntityId, AudioBusSnapshot>;
  const selectedIds = (document.selection?.selectedIds ?? []).map((id) => stableEntityId(id));
  const markers = Object.fromEntries(
    (document.markers ?? []).map((marker) => {
      const id = stableEntityId(marker.id);
      const value: MarkerSnapshot = {
        id,
        frame: masterFrame(BigInt(marker.frame)),
        duration: masterFrame(BigInt(marker.duration)),
        label: marker.label,
        category: marker.category,
        issueSeverity: marker.issueSeverity,
        annotationReferenceIds: marker.annotationReferenceIds.map((item) => stableEntityId(item)),
        ripplePolicy: marker.ripplePolicy,
      };
      return [id, value];
    }),
  ) as Record<StableEntityId, MarkerSnapshot>;
  const automation = Object.fromEntries(
    (document.automation ?? []).map((lane) => {
      const id = stableEntityId(lane.id);
      const value: AutomationLaneSnapshot = {
        ...lane,
        id,
        ownerEntityId: stableEntityId(lane.ownerEntityId),
        keyframeIds: lane.keyframeIds.map((keyframeId) => stableEntityId(keyframeId)),
      };
      return [id, value];
    }),
  ) as Record<StableEntityId, AutomationLaneSnapshot>;
  return assertValidTimelineCore({
    schemaVersion: "1.0.0",
    id: stableEntityId(document.timelineId),
    projectId: stableEntityId(document.projectId),
    revisionId: stableEntityId(document.revisionId),
    name: "Chai Studio timeline",
    fps: document.fps,
    duration: masterFrame(BigInt(document.durationFrames)),
    trackIds,
    tracks,
    audioBusIds,
    audioBuses,
    clips,
    nestedSequences: {},
    keyframes,
    markers,
    transitions: {},
    bridges: {},
    captions: {},
    automation,
    professionalMetadata: document.professionalMetadata ?? {},
    selection: {
      primaryId: document.selection?.primaryId == null ? null : stableEntityId(document.selection.primaryId),
      selectedIds,
      anchorId: document.selection?.anchorId == null ? null : stableEntityId(document.selection.anchorId),
    },
    inOutRange:
      document.inOutRange == null
        ? null
        : createFrameRange(
            masterFrame(BigInt(document.inOutRange.startFrame)),
            masterFrame(BigInt(document.inOutRange.endFrame)),
          ),
  });
};

export const timelineSnapshotToDocument = (
  snapshot: TimelineSnapshotV1,
  previous: TimelineDocument,
  revisionId: string,
): TimelineDocument => ({
  ...previous,
  revisionId,
  timelineId: snapshot.id,
  fps: snapshot.fps,
  durationFrames: serializeBigInt(snapshot.duration),
  tracks: snapshot.trackIds.map((trackId, order) => {
    const track = snapshot.tracks[trackId];
    if (track === undefined) throw new Error(`Timeline track ${trackId} is missing.`);
    return {
      id: track.id,
      kind: track.kind,
      name: track.name,
      order,
      locked: track.locked,
      hidden: track.hidden,
      muted: track.muted,
      solo: track.solo,
      clips: track.clipIds.map((clipId) => {
        const clip = snapshot.clips[clipId];
        if (clip === undefined) throw new Error(`Timeline clip ${clipId} is missing.`);
        const prior = previous.tracks.flatMap((item) => item.clips).find((item) => item.id === clip.id);
        const capability = clip.metadata.capability ?? prior?.capability ?? "unified";
        return {
          id: clip.id,
          assetId: clip.assetId,
          engine: clip.engine,
          startFrame: serializeBigInt(clip.range.start),
          durationFrames: serializeBigInt(clip.range.end - clip.range.start),
          sourceInFrame: serializeBigInt(clip.sourceRange.start),
          sourceDurationFrames: serializeBigInt(clip.sourceRange.end - clip.sourceRange.start),
          capability: isCapability(capability) ? capability : "unified",
          audioBusId: prior?.audioBusId ?? track.audioBusId,
          name: clip.name,
          linkGroupId: clip.linkGroupId,
          selectionGroupId: clip.selectionGroupId,
          metadata: clip.metadata,
          ...(clip.properties === undefined ? {} : { properties: clip.properties }),
        };
      }),
    };
  }),
  audioBusIds: snapshot.audioBusIds,
  selection: {
    primaryId: snapshot.selection.primaryId,
    selectedIds: snapshot.selection.selectedIds,
    anchorId: snapshot.selection.anchorId,
  },
  inOutRange:
    snapshot.inOutRange === null
      ? null
      : {
          startFrame: serializeBigInt(snapshot.inOutRange.start),
          endFrame: serializeBigInt(snapshot.inOutRange.end),
        },
  markers: Object.values(snapshot.markers)
    .sort((left, right) =>
      left.frame === right.frame ? left.id.localeCompare(right.id, "en") : left.frame < right.frame ? -1 : 1,
    )
    .map((marker) => ({
      id: marker.id,
      frame: serializeBigInt(marker.frame),
      duration: serializeBigInt(marker.duration),
      label: marker.label,
      category: marker.category,
      issueSeverity: marker.issueSeverity,
      annotationReferenceIds: marker.annotationReferenceIds,
      ripplePolicy: marker.ripplePolicy,
    })),
  keyframes: Object.values(snapshot.keyframes)
    .sort((left, right) =>
      left.frame === right.frame ? left.id.localeCompare(right.id, "en") : left.frame < right.frame ? -1 : 1,
    )
    .map((keyframe) => ({
      ...keyframe,
      frame: serializeBigInt(keyframe.frame),
    })),
  automation: Object.values(snapshot.automation).sort((left, right) => left.id.localeCompare(right.id, "en")),
  professionalMetadata: snapshot.professionalMetadata ?? {},
});

export const executeTimelineDocumentEdit = (
  document: TimelineDocument,
  operation: JsonValue,
  revisionId: string,
): TimelineDocumentEditResult => {
  const command = reviveOperation(operation);
  const result = executeTimelineCommand(timelineDocumentToSnapshot(document), command);
  return {
    timeline: timelineSnapshotToDocument(result.snapshot, document, revisionId),
    label: result.label,
    diffSummary: result.diffSummary,
    affectedEntityIds: result.affectedEntityIds,
    warnings: [],
  };
};

const reviveOperation = (value: JsonValue): TimelineEditCommand => {
  if (
    !isObject(value) ||
    typeof value.kind !== "string" ||
    !supportedOperationKinds.has(value.kind as never)
  ) {
    throw new Error("Unsupported or malformed timeline edit operation.");
  }
  return reviveFrames(value) as TimelineEditCommand;
};

const reviveFrames = (value: JsonValue, key = ""): unknown => {
  if (Array.isArray(value)) return value.map((item: JsonValue) => reviveFrames(item));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, reviveFrames(item, name)]));
  }
  if (typeof value === "string" && bigintKeys.has(key) && /^-?[0-9]+$/.test(value)) return BigInt(value);
  return value;
};

const isObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const capabilities = new Set([
  "native",
  "unified",
  "bake_required",
  "fallback_available",
  "unsupported",
  "experimental",
] as const);

const isCapability = (
  value: string,
): value is NonNullable<TimelineDocument["tracks"][number]["clips"][number]["capability"]> =>
  capabilities.has(value as never);
