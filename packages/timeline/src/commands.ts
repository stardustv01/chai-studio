import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import type {
  AutomationLaneSnapshot,
  ClipSnapshot,
  KeyframeSnapshot,
  MarkerSnapshot,
  SelectionSnapshot,
  StableEntityId,
  TimelinePropertyValue,
  TimelineSnapshotV1,
  TrackSnapshot,
} from "./model.js";
import {
  createFrameRange,
  frameRangeDuration,
  frameRangesOverlap,
  masterFrame,
  type FrameRange,
  type MasterFrame,
} from "./range.js";
import { createTimelineSourceTransform, mapFrameExact } from "./transform.js";
import { assertValidTimelineCore, validateClipPlacement } from "./validation.js";
import { diffTimelineSnapshots, type TimelineSnapshotDiff } from "./diff.js";
import { applyProfessionalTimelineCommand, type ProfessionalTimelineCommand } from "./professional.js";

export type TimelineSelectionMode = "replace" | "add" | "toggle";

export interface SelectTimelineCommand {
  readonly kind: "selection.set";
  readonly entityIds: readonly StableEntityId[];
  readonly mode: TimelineSelectionMode;
  readonly primaryId: StableEntityId | null;
}

export interface ClipMoveTarget {
  readonly clipId: StableEntityId;
  readonly trackId: StableEntityId;
  readonly start: MasterFrame;
}

export interface MoveClipsCommand {
  readonly kind: "clips.move";
  readonly moves: readonly ClipMoveTarget[];
}

export interface MoveClipsToNewTrackCommand {
  readonly kind: "clips.move-to-new-track";
  readonly track: TrackSnapshot;
  readonly atIndex: number;
  readonly moves: readonly ClipMoveTarget[];
}

export interface InsertClipCommand {
  readonly kind: "clip.insert";
  readonly clip: ClipSnapshot;
}

export interface OverwriteClipCommand {
  readonly kind: "clip.overwrite";
  readonly clip: ClipSnapshot;
}

export interface ReplaceClipCommand {
  readonly kind: "clip.replace";
  readonly clipId: StableEntityId;
  readonly replacement: ClipSnapshot;
}

export interface DuplicateClipMapping {
  readonly sourceClipId: StableEntityId;
  readonly newClipId: StableEntityId;
  readonly targetTrackId: StableEntityId;
}

export interface DuplicateClipsCommand {
  readonly kind: "clips.duplicate";
  readonly mappings: readonly DuplicateClipMapping[];
  readonly delta: MasterFrame;
}

export interface TimelineClipboard {
  readonly schemaVersion: "1.0.0";
  readonly sourceTimelineId: StableEntityId;
  readonly origin: MasterFrame;
  readonly clips: readonly ClipSnapshot[];
}

export interface PasteClipMapping {
  readonly sourceClipId: StableEntityId;
  readonly newClipId: StableEntityId;
  readonly targetTrackId: StableEntityId;
}

export interface PasteClipsCommand {
  readonly kind: "clips.paste";
  readonly clipboard: TimelineClipboard;
  readonly mappings: readonly PasteClipMapping[];
  readonly atFrame: MasterFrame;
}

export interface SetClipGroupCommand {
  readonly kind: "clips.group";
  readonly clipIds: readonly StableEntityId[];
  readonly groupId: StableEntityId | null;
}

export interface SetClipLinkCommand {
  readonly kind: "clips.link";
  readonly clipIds: readonly StableEntityId[];
  readonly linkGroupId: StableEntityId | null;
}

export interface ClipSplitMapping {
  readonly clipId: StableEntityId;
  readonly rightClipId: StableEntityId;
  readonly rightAutomationLaneIds?: Readonly<Partial<Record<StableEntityId, StableEntityId>>>;
}

export interface SplitClipsCommand {
  readonly kind: "clips.split";
  readonly atFrame: MasterFrame;
  readonly splits: readonly ClipSplitMapping[];
}

export interface ClipTrimTarget {
  readonly clipId: StableEntityId;
  readonly edge: "in" | "out";
  readonly toFrame: MasterFrame;
}

export interface TrimClipsCommand {
  readonly kind: "clips.trim";
  readonly trims: readonly ClipTrimTarget[];
  readonly ripple: boolean;
}

export interface RemoveClipsCommand {
  readonly kind: "clips.lift" | "clips.delete" | "clips.ripple-delete";
  readonly clipIds: readonly StableEntityId[];
}

export interface SetInOutRangeCommand {
  readonly kind: "range.set";
  readonly range: FrameRange;
}

export interface ClearInOutRangeCommand {
  readonly kind: "range.clear";
}

export interface AddTrackCommand {
  readonly kind: "track.add";
  readonly track: TrackSnapshot;
  readonly atIndex: number;
}

export interface UpdateTrackMetadataCommand {
  readonly kind: "track.update";
  readonly trackId: StableEntityId;
  readonly changes: Partial<
    Pick<TrackSnapshot, "name" | "locked" | "hidden" | "muted" | "solo" | "audioBusId">
  >;
}

export interface RemoveTrackCommand {
  readonly kind: "track.remove";
  readonly trackId: StableEntityId;
  readonly removeClips: boolean;
}

export interface ReorderTracksCommand {
  readonly kind: "tracks.reorder";
  readonly trackIds: readonly StableEntityId[];
}

export interface UpdateClipMetadataCommand {
  readonly kind: "clip.update";
  readonly clipId: StableEntityId;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly metadataMode: "merge" | "replace";
}

export interface UpdateClipPropertiesCommand {
  readonly kind: "clips.properties.update";
  readonly clipIds: readonly StableEntityId[];
  readonly changes: Readonly<Record<string, TimelinePropertyValue>>;
}

export interface ConvertClipPropertiesToSharedCommand {
  readonly kind: "clips.properties.convert-to-shared";
  readonly clipIds: readonly StableEntityId[];
  readonly propertyPaths: readonly string[];
}

export interface AddMarkerCommand {
  readonly kind: "marker.add";
  readonly marker: MarkerSnapshot;
}

export interface UpdateMarkerCommand {
  readonly kind: "marker.update";
  readonly markerId: StableEntityId;
  readonly changes: Partial<
    Pick<
      MarkerSnapshot,
      | "frame"
      | "duration"
      | "label"
      | "category"
      | "issueSeverity"
      | "annotationReferenceIds"
      | "ripplePolicy"
    >
  >;
}

export interface RemoveMarkersCommand {
  readonly kind: "markers.remove";
  readonly markerIds: readonly StableEntityId[];
}

export interface AddAutomationLaneCommand {
  readonly kind: "automation-lane.add";
  readonly lane: AutomationLaneSnapshot;
}

export interface RemoveAutomationLanesCommand {
  readonly kind: "automation-lanes.remove";
  readonly laneIds: readonly StableEntityId[];
  readonly removeKeyframes: boolean;
}

export interface AddKeyframeCommand {
  readonly kind: "keyframe.add";
  readonly keyframe: KeyframeSnapshot;
  readonly automationLaneId: StableEntityId | null;
}

export interface AddKeyframesCommand {
  readonly kind: "keyframes.add";
  readonly entries: readonly {
    readonly keyframe: KeyframeSnapshot;
    readonly automationLaneId: StableEntityId | null;
  }[];
}

export interface UpdateKeyframeCommand {
  readonly kind: "keyframe.update";
  readonly keyframeId: StableEntityId;
  readonly changes: Partial<
    Pick<
      KeyframeSnapshot,
      | "frame"
      | "value"
      | "interpolation"
      | "inTangent"
      | "outTangent"
      | "authority"
      | "preserveNativeAnimation"
    >
  >;
}

export interface UpdateKeyframesCommand {
  readonly kind: "keyframes.update";
  readonly updates: readonly {
    readonly keyframeId: StableEntityId;
    readonly changes: UpdateKeyframeCommand["changes"];
  }[];
}

export interface RemoveKeyframesCommand {
  readonly kind: "keyframes.remove";
  readonly keyframeIds: readonly StableEntityId[];
}

export interface RestoreTimelineCommand {
  readonly kind: "timeline.restore";
  readonly snapshot: TimelineSnapshotV1;
  readonly reason: string;
}

export type TimelineEditCommand =
  | SelectTimelineCommand
  | MoveClipsCommand
  | MoveClipsToNewTrackCommand
  | InsertClipCommand
  | OverwriteClipCommand
  | ReplaceClipCommand
  | DuplicateClipsCommand
  | PasteClipsCommand
  | SetClipGroupCommand
  | SetClipLinkCommand
  | SplitClipsCommand
  | TrimClipsCommand
  | RemoveClipsCommand
  | SetInOutRangeCommand
  | ClearInOutRangeCommand
  | AddTrackCommand
  | UpdateTrackMetadataCommand
  | RemoveTrackCommand
  | ReorderTracksCommand
  | UpdateClipMetadataCommand
  | UpdateClipPropertiesCommand
  | ConvertClipPropertiesToSharedCommand
  | AddMarkerCommand
  | UpdateMarkerCommand
  | RemoveMarkersCommand
  | AddAutomationLaneCommand
  | RemoveAutomationLanesCommand
  | AddKeyframeCommand
  | AddKeyframesCommand
  | UpdateKeyframeCommand
  | UpdateKeyframesCommand
  | RemoveKeyframesCommand
  | ProfessionalTimelineCommand
  | RestoreTimelineCommand;

export interface TimelineEditResult {
  readonly snapshot: TimelineSnapshotV1;
  readonly inverse: TimelineEditCommand;
  readonly label: string;
  readonly diffSummary: string;
  readonly affectedEntityIds: readonly StableEntityId[];
  readonly diff: TimelineSnapshotDiff;
}

export const executeTimelineCommand = (
  timeline: TimelineSnapshotV1,
  command: TimelineEditCommand,
): TimelineEditResult => {
  assertValidTimelineCore(timeline);
  switch (command.kind) {
    case "selection.set":
      return applySelection(timeline, command);
    case "clips.move":
      return applyMoves(timeline, command);
    case "clips.move-to-new-track":
      return applyMovesToNewTrack(timeline, command);
    case "clip.insert":
      return applyInsert(timeline, command);
    case "clip.overwrite":
      return applyOverwrite(timeline, command);
    case "clip.replace":
      return applyReplace(timeline, command);
    case "clips.duplicate":
      return applyDuplicate(timeline, command);
    case "clips.paste":
      return applyPaste(timeline, command);
    case "clips.group":
      return applyGroup(timeline, command);
    case "clips.link":
      return applyLink(timeline, command);
    case "clips.split":
      return applySplit(timeline, command);
    case "clips.trim":
      return applyTrim(timeline, command);
    case "clips.lift":
    case "clips.delete":
    case "clips.ripple-delete":
      return applyRemove(timeline, command);
    case "range.set":
    case "range.clear":
      return applyInOutRange(timeline, command);
    case "track.add":
      return applyAddTrack(timeline, command);
    case "track.update":
      return applyUpdateTrack(timeline, command);
    case "track.remove":
      return applyRemoveTrack(timeline, command);
    case "tracks.reorder":
      return applyReorderTracks(timeline, command);
    case "clip.update":
      return applyUpdateClipMetadata(timeline, command);
    case "clips.properties.update":
      return applyUpdateClipProperties(timeline, command);
    case "clips.properties.convert-to-shared":
      return applyConvertClipPropertiesToShared(timeline, command);
    case "marker.add":
      return applyAddMarker(timeline, command);
    case "marker.update":
      return applyUpdateMarker(timeline, command);
    case "markers.remove":
      return applyRemoveMarkers(timeline, command);
    case "automation-lane.add":
      return applyAddAutomationLane(timeline, command);
    case "automation-lanes.remove":
      return applyRemoveAutomationLanes(timeline, command);
    case "keyframe.add":
      return applyAddKeyframe(timeline, command);
    case "keyframes.add":
      return applyAddKeyframes(timeline, command);
    case "keyframe.update":
      return applyUpdateKeyframe(timeline, command);
    case "keyframes.update":
      return applyUpdateKeyframes(timeline, command);
    case "keyframes.remove":
      return applyRemoveKeyframes(timeline, command);
    case "clips.roll":
    case "clip.slip":
    case "clip.slide":
    case "compound.create":
    case "compound.flatten":
    case "takes.set":
    case "take.activate":
    case "clip.playback":
    case "clip.speed":
    case "clip.time-remap":
    case "adjustment.upsert":
    case "adjustment.remove":
    case "bridge.advanced.upsert":
    case "bridge.advanced.remove": {
      const professional = applyProfessionalTimelineCommand(timeline, command);
      return result(
        professional.snapshot,
        timeline,
        professional.label,
        professional.diffSummary,
        professional.affectedEntityIds,
      );
    }
    case "timeline.restore": {
      const restored = assertValidTimelineCore(command.snapshot);
      return result(restored, timeline, "Restore timeline", command.reason, allEntityIds(restored));
    }
  }
};

export const createNudgeCommand = (
  timeline: TimelineSnapshotV1,
  clipIds: readonly StableEntityId[],
  delta: MasterFrame,
): MoveClipsCommand => ({
  kind: "clips.move",
  moves: clipIds.map((clipId) => {
    const clip = requireClip(timeline, clipId);
    return { clipId, trackId: clip.trackId, start: masterFrame(clip.range.start + delta) };
  }),
});

export const createBladeCommand = (
  timeline: TimelineSnapshotV1,
  atFrame: MasterFrame,
  rightClipIds: Readonly<Record<StableEntityId, StableEntityId>>,
): SplitClipsCommand => {
  const splits = Object.values(timeline.clips)
    .filter((clip) => clip.range.start < atFrame && atFrame < clip.range.end)
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((clip) => {
      const rightClipId = rightClipIds[clip.id];
      if (rightClipId === undefined) {
        throw commandError(
          "timeline.split.id-mapping-missing",
          `Blade requires an explicit right-side stable ID for ${clip.id}.`,
        );
      }
      return { clipId: clip.id, rightClipId };
    });
  if (splits.length === 0) {
    throw commandError("timeline.split.no-intersection", "Blade does not intersect any clip interior.");
  }
  return { kind: "clips.split", atFrame, splits };
};

export const copyTimelineClips = (
  timeline: TimelineSnapshotV1,
  clipIds: readonly StableEntityId[],
): TimelineClipboard => {
  const clips = uniqueIds(clipIds).map((id) => requireClip(timeline, id));
  if (clips.length === 0) throw commandError("timeline.copy.empty", "No clips were selected for copy.");
  const first = clips[0];
  if (first === undefined) throw commandError("timeline.copy.empty", "No clips were selected for copy.");
  const origin = clips.reduce(
    (minimum, clip) => (clip.range.start < minimum ? clip.range.start : minimum),
    first.range.start,
  );
  return { schemaVersion: "1.0.0", sourceTimelineId: timeline.id, origin, clips };
};

const applySelection = (timeline: TimelineSnapshotV1, command: SelectTimelineCommand): TimelineEditResult => {
  command.entityIds.forEach((id) => {
    assertEntityExists(timeline, id);
  });
  if (command.primaryId !== null) assertEntityExists(timeline, command.primaryId);
  const prior = timeline.selection;
  const selected = new Set(prior.selectedIds);
  if (command.mode === "replace") selected.clear();
  for (const id of uniqueIds(command.entityIds)) {
    if (command.mode === "toggle" && selected.has(id)) selected.delete(id);
    else selected.add(id);
  }
  const selectedIds = [...selected].sort((left, right) => left.localeCompare(right, "en"));
  const primaryId =
    command.primaryId !== null && selected.has(command.primaryId)
      ? command.primaryId
      : (selectedIds[0] ?? null);
  const selection: SelectionSnapshot = {
    primaryId,
    selectedIds,
    anchorId: command.mode === "replace" ? primaryId : prior.anchorId,
  };
  const snapshot = { ...timeline, selection };
  return {
    snapshot,
    inverse: {
      kind: "selection.set",
      entityIds: prior.selectedIds,
      mode: "replace",
      primaryId: prior.primaryId,
    },
    label: selectedIds.length > 1 ? "Select items" : "Select item",
    diffSummary: `Selection now contains ${String(selectedIds.length)} stable item(s).`,
    affectedEntityIds: selectedIds,
    diff: diffTimelineSnapshots(timeline, snapshot),
  };
};

const applyMoves = (timeline: TimelineSnapshotV1, command: MoveClipsCommand): TimelineEditResult => {
  if (command.moves.length === 0) throw commandError("timeline.move.empty", "Move command has no clips.");
  const movingIds = new Set(command.moves.map((move) => move.clipId));
  if (movingIds.size !== command.moves.length) {
    throw commandError("timeline.move.duplicate", "Move command repeats a clip ID.");
  }
  let working = removeClipRelations(timeline, [...movingIds]);
  const movedClips: Record<StableEntityId, ClipSnapshot> = { ...working.clips };
  let keyframes = working.keyframes;
  for (const move of command.moves) {
    const original = requireClip(timeline, move.clipId);
    assertTrackWritable(timeline, original.trackId);
    assertTrackWritable(timeline, move.trackId);
    const duration = frameRangeDuration(original.range);
    const moved: ClipSnapshot = {
      ...original,
      trackId: move.trackId,
      range: createFrameRange(move.start, masterFrame(move.start + duration)),
    };
    const placement = validateClipPlacement(
      timelineForPlacement({ ...working, clips: movedClips }, moved),
      moved,
    );
    assertPlacement(placement.issues, moved.id);
    movedClips[moved.id] = moved;
    keyframes = shiftOwnedKeyframes(
      keyframes,
      [moved.id],
      masterFrame(move.start - original.range.start, true),
    );
  }
  working = finalizeClipMutation({ ...working, clips: movedClips, keyframes }, [...movingIds]);
  return result(
    working,
    timeline,
    command.moves.length === 1 ? "Move clip" : "Move clips",
    `Moved ${String(command.moves.length)} clip(s) using exact master-frame placement.`,
    [...movingIds],
  );
};

const applyMovesToNewTrack = (
  timeline: TimelineSnapshotV1,
  command: MoveClipsToNewTrackCommand,
): TimelineEditResult => {
  if (command.moves.length === 0) {
    throw commandError("timeline.move-to-new-track.empty", "Move-to-new-track command has no clips.");
  }
  if (command.moves.some((move) => move.trackId !== command.track.id)) {
    throw commandError(
      "timeline.move-to-new-track.target-mismatch",
      "Every moved clip must target the new track.",
    );
  }
  const added = applyAddTrack(timeline, {
    kind: "track.add",
    track: command.track,
    atIndex: command.atIndex,
  });
  const moved = applyMoves(added.snapshot, { kind: "clips.move", moves: command.moves });
  const clipIds = command.moves.map((move) => move.clipId);
  return result(
    moved.snapshot,
    timeline,
    clipIds.length === 1 ? "Create track and move clip" : "Create track and move clips",
    `Created ${command.track.name} and moved ${String(clipIds.length)} clip(s) onto it as one edit.`,
    [command.track.id, ...clipIds],
  );
};

const applyInsert = (timeline: TimelineSnapshotV1, command: InsertClipCommand): TimelineEditResult => {
  assertNewClipId(timeline, command.clip.id);
  assertTrackWritable(timeline, command.clip.trackId);
  const duration = frameRangeDuration(command.clip.range);
  const track = requireTrack(timeline, command.clip.trackId);
  const shifted: Record<StableEntityId, ClipSnapshot> = { ...timeline.clips };
  let keyframes = timeline.keyframes;
  for (const clipId of track.clipIds) {
    const clip = requireClip(timeline, clipId);
    if (clip.range.start < command.clip.range.start && clip.range.end > command.clip.range.start) {
      throw commandError(
        "timeline.insert.inside-clip",
        `Insert point falls inside ${clip.id}; split or trim before inserting.`,
      );
    }
    if (clip.range.start >= command.clip.range.start) {
      shifted[clip.id] = {
        ...clip,
        range: createFrameRange(
          masterFrame(clip.range.start + duration),
          masterFrame(clip.range.end + duration),
        ),
      };
      keyframes = shiftOwnedKeyframes(keyframes, [clip.id], duration);
    }
  }
  shifted[command.clip.id] = command.clip;
  const markers = shiftContentMarkers(timeline.markers, command.clip.range.start, duration);
  const snapshot = finalizeClipMutation({ ...timeline, clips: shifted, markers, keyframes }, [
    command.clip.id,
  ]);
  return result(
    snapshot,
    timeline,
    "Insert clip",
    `Inserted ${command.clip.name} and shifted later clips by ${String(duration)} frame(s).`,
    [command.clip.id, ...track.clipIds],
  );
};

const applyOverwrite = (timeline: TimelineSnapshotV1, command: OverwriteClipCommand): TimelineEditResult => {
  assertNewClipId(timeline, command.clip.id);
  assertTrackWritable(timeline, command.clip.trackId);
  const track = requireTrack(timeline, command.clip.trackId);
  const overwritten = track.clipIds.filter((id) => {
    const clip = requireClip(timeline, id);
    return frameRangesOverlap(clip.range, command.clip.range);
  });
  let working = removeClips(timeline, overwritten);
  working = finalizeClipMutation(
    { ...working, clips: { ...working.clips, [command.clip.id]: command.clip } },
    [command.clip.id],
  );
  return result(
    working,
    timeline,
    "Overwrite clip",
    `Placed ${command.clip.name} and replaced ${String(overwritten.length)} overlapping clip(s).`,
    [command.clip.id, ...overwritten],
  );
};

const applyReplace = (timeline: TimelineSnapshotV1, command: ReplaceClipCommand): TimelineEditResult => {
  const existing = requireClip(timeline, command.clipId);
  assertTrackWritable(timeline, existing.trackId);
  assertTrackWritable(timeline, command.replacement.trackId);
  if (command.replacement.id !== command.clipId) {
    throw commandError(
      "timeline.replace.id-changed",
      "Replace must preserve the stable clip ID; duplicate creates a new identity.",
    );
  }
  const without = removeClipRelations(timeline, [command.clipId]);
  assertPlacement(
    validateClipPlacement(timelineForPlacement(without, command.replacement), command.replacement).issues,
    command.clipId,
  );
  const snapshot = finalizeClipMutation(
    { ...without, clips: { ...without.clips, [command.clipId]: command.replacement } },
    [command.clipId],
  );
  return result(
    snapshot,
    timeline,
    "Replace clip",
    `Replaced ${existing.name} while preserving stable identity ${command.clipId}.`,
    [command.clipId],
  );
};

const applyDuplicate = (timeline: TimelineSnapshotV1, command: DuplicateClipsCommand): TimelineEditResult => {
  if (command.mappings.length === 0) {
    throw commandError("timeline.duplicate.empty", "Duplicate command has no mappings.");
  }
  let working = timeline;
  const created: StableEntityId[] = [];
  for (const mapping of command.mappings) {
    assertNewClipId(working, mapping.newClipId);
    const source = requireClip(timeline, mapping.sourceClipId);
    assertTrackWritable(timeline, mapping.targetTrackId);
    const duplicated: ClipSnapshot = {
      ...source,
      id: mapping.newClipId,
      trackId: mapping.targetTrackId,
      range: createFrameRange(
        masterFrame(source.range.start + command.delta),
        masterFrame(source.range.end + command.delta),
      ),
      transitionInId: null,
      transitionOutId: null,
      keyframeIds: [],
    };
    assertPlacement(
      validateClipPlacement(timelineForPlacement(working, duplicated), duplicated).issues,
      duplicated.id,
    );
    working = finalizeClipMutation({ ...working, clips: { ...working.clips, [duplicated.id]: duplicated } }, [
      duplicated.id,
    ]);
    created.push(duplicated.id);
  }
  return result(
    working,
    timeline,
    created.length === 1 ? "Duplicate clip" : "Duplicate clips",
    `Created ${String(created.length)} deterministic duplicate(s).`,
    created,
  );
};

const applyPaste = (timeline: TimelineSnapshotV1, command: PasteClipsCommand): TimelineEditResult => {
  if (command.mappings.length !== command.clipboard.clips.length) {
    throw commandError(
      "timeline.paste.mapping-incomplete",
      "Paste requires one explicit stable-ID mapping per clipboard clip.",
    );
  }
  const bySource = new Map(command.clipboard.clips.map((clip) => [clip.id, clip]));
  let working = timeline;
  const pasted: StableEntityId[] = [];
  for (const mapping of command.mappings) {
    const source = bySource.get(mapping.sourceClipId);
    if (source === undefined) {
      throw commandError(
        "timeline.paste.source-missing",
        `Clipboard clip ${mapping.sourceClipId} is missing.`,
      );
    }
    assertNewClipId(working, mapping.newClipId);
    assertTrackWritable(working, mapping.targetTrackId);
    const offset = source.range.start - command.clipboard.origin;
    const start = masterFrame(command.atFrame + offset);
    const pastedClip: ClipSnapshot = {
      ...source,
      id: mapping.newClipId,
      trackId: mapping.targetTrackId,
      range: createFrameRange(start, masterFrame(start + frameRangeDuration(source.range))),
      transitionInId: null,
      transitionOutId: null,
      keyframeIds: [],
    };
    assertPlacement(
      validateClipPlacement(timelineForPlacement(working, pastedClip), pastedClip).issues,
      pastedClip.id,
    );
    working = finalizeClipMutation({ ...working, clips: { ...working.clips, [pastedClip.id]: pastedClip } }, [
      pastedClip.id,
    ]);
    pasted.push(pastedClip.id);
  }
  return result(
    working,
    timeline,
    pasted.length === 1 ? "Paste clip" : "Paste clips",
    `Pasted ${String(pasted.length)} clip(s) at frame ${String(command.atFrame)}.`,
    pasted,
  );
};

const applyGroup = (timeline: TimelineSnapshotV1, command: SetClipGroupCommand): TimelineEditResult => {
  const clipIds = uniqueIds(command.clipIds);
  const clips = { ...timeline.clips };
  for (const id of clipIds) clips[id] = { ...requireClip(timeline, id), selectionGroupId: command.groupId };
  const snapshot = assertValidTimelineCore({ ...timeline, clips });
  return result(
    snapshot,
    timeline,
    command.groupId === null ? "Ungroup clips" : "Group clips",
    `${command.groupId === null ? "Cleared" : "Assigned"} selection group for ${String(clipIds.length)} clip(s).`,
    clipIds,
  );
};

const applyLink = (timeline: TimelineSnapshotV1, command: SetClipLinkCommand): TimelineEditResult => {
  const clipIds = uniqueIds(command.clipIds);
  const clips = { ...timeline.clips };
  for (const id of clipIds) clips[id] = { ...requireClip(timeline, id), linkGroupId: command.linkGroupId };
  const snapshot = assertValidTimelineCore({ ...timeline, clips });
  return result(
    snapshot,
    timeline,
    command.linkGroupId === null ? "Unlink clips" : "Link clips",
    `${command.linkGroupId === null ? "Cleared" : "Assigned"} link group for ${String(clipIds.length)} clip(s).`,
    clipIds,
  );
};

const applySplit = (timeline: TimelineSnapshotV1, command: SplitClipsCommand): TimelineEditResult => {
  if (command.splits.length === 0) {
    throw commandError("timeline.split.empty", "Split command has no clips.");
  }
  const clipIds = command.splits.map((mapping) => mapping.clipId);
  if (uniqueIds(clipIds).length !== clipIds.length) {
    throw commandError("timeline.split.duplicate", "Split command repeats a clip ID.");
  }
  assertLinkedCoverageAtFrame(timeline, clipIds, command.atFrame);
  const clips: Record<StableEntityId, ClipSnapshot> = { ...timeline.clips };
  const transitions = { ...timeline.transitions };
  const keyframes = { ...timeline.keyframes };
  const automation = { ...timeline.automation };
  const allocatedLaneIds = new Set(Object.keys(automation));
  const affected: StableEntityId[] = [];
  for (const mapping of command.splits) {
    const original = requireClip(timeline, mapping.clipId);
    assertTrackWritable(timeline, original.trackId);
    assertNewClipId({ ...timeline, clips }, mapping.rightClipId);
    if (!(original.range.start < command.atFrame && command.atFrame < original.range.end)) {
      throw commandError("timeline.split.boundary", `Split frame must be strictly inside ${original.id}.`);
    }
    const transform = createTimelineSourceTransform({
      timelineOrigin: original.range.start,
      sourceOrigin: original.sourceRange.start,
      timelineRate: timeline.fps,
      sourceRate: original.sourceRate,
      speed: original.speed,
    });
    const staticSource =
      original.sourceRange.end - original.sourceRange.start === 1n &&
      original.availableSourceRange.end - original.availableSourceRange.start === 1n;
    const sourceSplit = staticSource
      ? original.sourceRange.start
      : mapFrameExact(transform, command.atFrame, "floor");
    if (
      !staticSource &&
      !(original.sourceRange.start < sourceSplit && sourceSplit < original.sourceRange.end)
    ) {
      throw commandError(
        "timeline.split.source-boundary",
        `Split of ${original.id} collapses an exact source-side range.`,
      );
    }
    const leftKeyframeIds = original.keyframeIds.filter(
      (id) => timeline.keyframes[id]?.frame !== undefined && timeline.keyframes[id].frame < command.atFrame,
    );
    const rightKeyframeIds = original.keyframeIds.filter(
      (id) => timeline.keyframes[id]?.frame !== undefined && timeline.keyframes[id].frame >= command.atFrame,
    );
    for (const keyframe of Object.values(timeline.keyframes)) {
      if (keyframe.ownerEntityId === original.id && keyframe.frame >= command.atFrame) {
        keyframes[keyframe.id] = { ...keyframe, ownerEntityId: mapping.rightClipId };
        affected.push(keyframe.id);
      }
    }
    for (const lane of Object.values(timeline.automation).filter(
      (candidate) => candidate.ownerEntityId === original.id,
    )) {
      const leftLaneKeyframes = lane.keyframeIds.filter(
        (id) => timeline.keyframes[id]?.frame !== undefined && timeline.keyframes[id].frame < command.atFrame,
      );
      const rightLaneKeyframes = lane.keyframeIds.filter(
        (id) =>
          timeline.keyframes[id]?.frame !== undefined && timeline.keyframes[id].frame >= command.atFrame,
      );
      if (rightLaneKeyframes.length === 0) continue;
      const rightLaneId = mapping.rightAutomationLaneIds?.[lane.id];
      if (rightLaneId === undefined) {
        throw commandError(
          "timeline.split.automation-remap-required",
          `Split of ${original.id} requires an explicit right-side automation lane ID for ${lane.id}.`,
        );
      }
      if (allocatedLaneIds.has(rightLaneId)) {
        throw commandError(
          "timeline.split.automation-id-exists",
          `Split automation lane ID already exists: ${rightLaneId}.`,
        );
      }
      allocatedLaneIds.add(rightLaneId);
      automation[lane.id] = { ...lane, keyframeIds: leftLaneKeyframes };
      automation[rightLaneId] = {
        ...lane,
        id: rightLaneId,
        ownerEntityId: mapping.rightClipId,
        keyframeIds: rightLaneKeyframes,
      };
      affected.push(lane.id, rightLaneId);
    }
    const left: ClipSnapshot = {
      ...original,
      range: createFrameRange(original.range.start, command.atFrame),
      sourceRange: staticSource
        ? original.sourceRange
        : createFrameRange(original.sourceRange.start, sourceSplit),
      transitionOutId: null,
      keyframeIds: leftKeyframeIds,
    };
    const right: ClipSnapshot = {
      ...original,
      id: mapping.rightClipId,
      range: createFrameRange(command.atFrame, original.range.end),
      sourceRange: staticSource
        ? original.sourceRange
        : createFrameRange(sourceSplit, original.sourceRange.end),
      transitionInId: null,
      keyframeIds: rightKeyframeIds,
    };
    clips[left.id] = left;
    clips[right.id] = right;
    if (original.transitionOutId !== null) {
      const outgoing = transitions[original.transitionOutId];
      if (outgoing?.fromClipId === original.id) {
        transitions[outgoing.id] = { ...outgoing, fromClipId: right.id };
      }
    }
    affected.push(left.id, right.id);
  }
  const snapshot = finalizeClipMutation(
    { ...timeline, clips, transitions, keyframes, automation },
    affected.filter((id) => clips[id] !== undefined),
  );
  return result(
    snapshot,
    timeline,
    command.splits.length === 1 ? "Split clip" : "Split clips",
    `Split ${String(command.splits.length)} clip(s) at exact master frame ${String(command.atFrame)}.`,
    affected,
  );
};

const applyTrim = (timeline: TimelineSnapshotV1, command: TrimClipsCommand): TimelineEditResult => {
  if (command.trims.length === 0) {
    throw commandError("timeline.trim.empty", "Trim command has no clip edges.");
  }
  const clipIds = command.trims.map((trim) => trim.clipId);
  if (uniqueIds(clipIds).length !== clipIds.length) {
    throw commandError("timeline.trim.duplicate", "Trim command repeats a clip ID.");
  }
  assertLinkedCoverage(timeline, clipIds);
  const trackIds = command.trims.map((trim) => requireClip(timeline, trim.clipId).trackId);
  if (uniqueIds(trackIds).length !== trackIds.length) {
    throw commandError("timeline.trim.track-ambiguous", "Trim supports at most one edited edge per track.");
  }
  const clips: Record<StableEntityId, ClipSnapshot> = { ...timeline.clips };
  let keyframes = timeline.keyframes;
  const affected = new Set<StableEntityId>();
  const rippleMarkerShifts: Readonly<{ boundary: MasterFrame; delta: MasterFrame }>[] = [];
  for (const trim of command.trims) {
    const original = requireClip(timeline, trim.clipId);
    assertTrackWritable(timeline, original.trackId);
    const transform = createTimelineSourceTransform({
      timelineOrigin: original.range.start,
      sourceOrigin: original.sourceRange.start,
      timelineRate: timeline.fps,
      sourceRate: original.sourceRate,
      speed: original.speed,
    });
    let range: FrameRange;
    let sourceRange: FrameRange;
    let followingDelta = masterFrame(0n, true);
    if (trim.edge === "in") {
      if (trim.toFrame >= original.range.end) {
        throw commandError("timeline.trim.range-collapsed", `Trim-in collapses ${original.id}.`);
      }
      const sourceStart = mapFrameExact(transform, trim.toFrame, "floor");
      sourceRange = createFrameRange(sourceStart, original.sourceRange.end);
      if (command.ripple) {
        const delta = masterFrame(trim.toFrame - original.range.start, true);
        range = createFrameRange(original.range.start, masterFrame(original.range.end - delta));
        followingDelta = masterFrame(0n - delta, true);
      } else {
        range = createFrameRange(trim.toFrame, original.range.end);
      }
    } else {
      if (trim.toFrame <= original.range.start) {
        throw commandError("timeline.trim.range-collapsed", `Trim-out collapses ${original.id}.`);
      }
      const sourceEnd = mapFrameExact(transform, trim.toFrame, "ceil");
      sourceRange = createFrameRange(original.sourceRange.start, sourceEnd);
      range = createFrameRange(original.range.start, trim.toFrame);
      if (command.ripple) followingDelta = masterFrame(trim.toFrame - original.range.end, true);
    }
    if (!rangeContains(original.availableSourceRange, sourceRange)) {
      throw commandError(
        "timeline.clip.handles-exceeded",
        `Trim exceeds available handles for ${original.id}.`,
      );
    }
    const keyframeOutside = original.keyframeIds.some((id) => {
      const keyframe = timeline.keyframes[id];
      return keyframe !== undefined && (keyframe.frame < range.start || keyframe.frame >= range.end);
    });
    if (keyframeOutside) {
      throw commandError(
        "timeline.trim.keyframe-outside",
        `Trim of ${original.id} would strand a keyframe outside its owner range.`,
      );
    }
    clips[original.id] = { ...original, range, sourceRange };
    affected.add(original.id);
    if (command.ripple && followingDelta !== 0n) {
      rippleMarkerShifts.push({ boundary: original.range.end, delta: followingDelta });
      for (const candidate of Object.values(timeline.clips)) {
        if (candidate.trackId !== original.trackId || candidate.range.start < original.range.end) continue;
        clips[candidate.id] = {
          ...candidate,
          range: createFrameRange(
            masterFrame(candidate.range.start + followingDelta),
            masterFrame(candidate.range.end + followingDelta),
          ),
        };
        keyframes = shiftOwnedKeyframes(keyframes, [candidate.id], followingDelta);
        affected.add(candidate.id);
      }
    }
  }
  let markers = timeline.markers;
  const appliedMarkerShifts = new Set<string>();
  for (const shift of rippleMarkerShifts) {
    const key = `${String(shift.boundary)}:${String(shift.delta)}`;
    if (appliedMarkerShifts.has(key)) continue;
    markers = shiftContentMarkers(markers, shift.boundary, shift.delta);
    appliedMarkerShifts.add(key);
  }
  const snapshot = finalizeClipMutation({ ...timeline, clips, markers, keyframes }, [...affected]);
  return result(
    snapshot,
    timeline,
    command.ripple ? "Ripple trim clips" : command.trims.length === 1 ? "Trim clip" : "Trim clips",
    `${command.ripple ? "Ripple-trimmed" : "Trimmed"} ${String(command.trims.length)} exact clip edge(s).`,
    [...affected],
  );
};

const applyRemove = (timeline: TimelineSnapshotV1, command: RemoveClipsCommand): TimelineEditResult => {
  const clipIds = uniqueIds(command.clipIds);
  if (clipIds.length === 0) {
    throw commandError("timeline.remove.empty", "Remove command has no clips.");
  }
  assertLinkedCoverage(timeline, clipIds);
  clipIds.forEach((id) => {
    assertTrackWritable(timeline, requireClip(timeline, id).trackId);
  });
  let working = removeClips(timeline, clipIds);
  const affected = new Set<StableEntityId>(clipIds);
  if (command.kind === "clips.ripple-delete") {
    const deletedByTrack = new Map<StableEntityId, FrameRange[]>();
    for (const id of clipIds) {
      const clip = requireClip(timeline, id);
      const ranges = deletedByTrack.get(clip.trackId) ?? [];
      ranges.push(clip.range);
      deletedByTrack.set(clip.trackId, ranges);
    }
    const clips: Record<StableEntityId, ClipSnapshot> = { ...working.clips };
    let keyframes = working.keyframes;
    for (const [trackId, ranges] of deletedByTrack) {
      const merged = mergeRanges(ranges);
      for (const clip of Object.values(working.clips)) {
        if (clip.trackId !== trackId) continue;
        const shift = merged.reduce(
          (total, range) => (range.end <= clip.range.start ? total + frameRangeDuration(range) : total),
          0n,
        );
        if (shift === 0n) continue;
        clips[clip.id] = {
          ...clip,
          range: createFrameRange(masterFrame(clip.range.start - shift), masterFrame(clip.range.end - shift)),
        };
        keyframes = shiftOwnedKeyframes(keyframes, [clip.id], masterFrame(0n - shift, true));
        affected.add(clip.id);
      }
    }
    const globalDeletedRanges = mergeRanges([...deletedByTrack.values()].flat());
    working = {
      ...working,
      clips,
      keyframes,
      markers: rippleDeleteContentMarkers(working.markers, globalDeletedRanges),
    };
  }
  const snapshot = finalizeClipMutation(working, []);
  const label =
    command.kind === "clips.ripple-delete"
      ? "Ripple delete clips"
      : command.kind === "clips.lift"
        ? "Lift clips"
        : "Delete clips";
  return result(
    snapshot,
    timeline,
    label,
    `${label} removed ${String(clipIds.length)} clip(s)${command.kind === "clips.ripple-delete" ? " and closed exact per-track gaps" : " without closing gaps"}.`,
    [...affected],
  );
};

const applyInOutRange = (
  timeline: TimelineSnapshotV1,
  command: SetInOutRangeCommand | ClearInOutRangeCommand,
): TimelineEditResult => {
  const range = command.kind === "range.clear" ? null : command.range;
  if (range !== null && (range.start < 0n || range.end > timeline.duration)) {
    throw commandError("timeline.range.out-of-bounds", "In/out range must stay inside timeline duration.");
  }
  return result(
    { ...timeline, inOutRange: range },
    timeline,
    range === null ? "Clear in/out range" : "Set in/out range",
    range === null
      ? "Cleared the persisted in/out range."
      : `Set persisted in/out range to [${String(range.start)}, ${String(range.end)}).`,
    [timeline.id],
  );
};

const applyAddTrack = (timeline: TimelineSnapshotV1, command: AddTrackCommand): TimelineEditResult => {
  if (timeline.tracks[command.track.id] !== undefined) {
    throw commandError("timeline.track.id-exists", `Track ID already exists: ${command.track.id}.`);
  }
  if (
    !Number.isSafeInteger(command.atIndex) ||
    command.atIndex < 0 ||
    command.atIndex > timeline.trackIds.length
  ) {
    throw commandError(
      "timeline.track.index-invalid",
      "Track insertion index is outside the ordered registry.",
    );
  }
  if (command.track.name.trim().length === 0) {
    throw commandError("timeline.track.name-empty", "Track name cannot be empty.");
  }
  if (command.track.clipIds.length > 0) {
    throw commandError(
      "timeline.track.add-with-clips",
      "A new track must begin with an empty clip registry.",
    );
  }
  const trackIds = [...timeline.trackIds];
  trackIds.splice(command.atIndex, 0, command.track.id);
  const snapshot = normalizeTrackOrder({
    ...timeline,
    trackIds,
    tracks: { ...timeline.tracks, [command.track.id]: command.track },
  });
  return result(
    snapshot,
    timeline,
    "Add track",
    `Added ${command.track.name} at deterministic track index ${String(command.atIndex)}.`,
    [command.track.id],
  );
};

const applyUpdateTrack = (
  timeline: TimelineSnapshotV1,
  command: UpdateTrackMetadataCommand,
): TimelineEditResult => {
  const track = requireTrack(timeline, command.trackId);
  if (Object.keys(command.changes).length === 0) {
    throw commandError("timeline.track.update-empty", "Track update has no metadata changes.");
  }
  if (command.changes.name?.trim().length === 0) {
    throw commandError("timeline.track.name-empty", "Track name cannot be empty.");
  }
  const updated: TrackSnapshot = { ...track, ...command.changes };
  const snapshot = assertValidTimelineCore({
    ...timeline,
    tracks: { ...timeline.tracks, [track.id]: updated },
  });
  return result(snapshot, timeline, "Update track", `Updated deterministic metadata for ${track.id}.`, [
    track.id,
  ]);
};

const applyRemoveTrack = (timeline: TimelineSnapshotV1, command: RemoveTrackCommand): TimelineEditResult => {
  const track = requireTrack(timeline, command.trackId);
  if (track.locked) {
    throw commandError("timeline.track.locked", `Track ${track.id} is locked.`);
  }
  if (track.clipIds.length > 0 && !command.removeClips) {
    throw commandError(
      "timeline.track.not-empty",
      `Track ${track.id} contains clips; removal requires explicit removeClips intent.`,
    );
  }
  if (command.removeClips) assertLinkedCoverage(timeline, track.clipIds);
  const withoutClips = command.removeClips ? removeClips(timeline, track.clipIds) : timeline;
  const tracks = Object.fromEntries(
    Object.values(withoutClips.tracks)
      .filter((candidate) => candidate.id !== track.id)
      .map((candidate) => [candidate.id, candidate]),
  ) as Readonly<TimelineSnapshotV1["tracks"]>;
  const snapshot = normalizeTrackOrder({
    ...withoutClips,
    trackIds: withoutClips.trackIds.filter((id) => id !== track.id),
    tracks,
  });
  return result(
    snapshot,
    timeline,
    "Remove track",
    `Removed ${track.name}${track.clipIds.length > 0 ? ` with ${String(track.clipIds.length)} clip(s)` : ""}.`,
    [track.id, ...track.clipIds],
  );
};

const applyReorderTracks = (
  timeline: TimelineSnapshotV1,
  command: ReorderTracksCommand,
): TimelineEditResult => {
  if (
    command.trackIds.length !== timeline.trackIds.length ||
    uniqueIds(command.trackIds).length !== command.trackIds.length ||
    command.trackIds.some((id) => timeline.tracks[id] === undefined)
  ) {
    throw commandError(
      "timeline.track.reorder-incomplete",
      "Track reorder must contain every existing stable track ID exactly once.",
    );
  }
  const snapshot = normalizeTrackOrder({ ...timeline, trackIds: [...command.trackIds] });
  return result(
    snapshot,
    timeline,
    "Reorder tracks",
    `Applied a complete deterministic order for ${String(command.trackIds.length)} track(s).`,
    command.trackIds,
  );
};

const applyUpdateClipMetadata = (
  timeline: TimelineSnapshotV1,
  command: UpdateClipMetadataCommand,
): TimelineEditResult => {
  const clip = requireClip(timeline, command.clipId);
  assertTrackWritable(timeline, clip.trackId);
  if (command.name === undefined && command.metadata === undefined) {
    throw commandError("timeline.clip.update-empty", "Clip update has no name or metadata changes.");
  }
  if (command.name?.trim().length === 0) {
    throw commandError("timeline.clip.name-empty", "Clip name cannot be empty.");
  }
  if (
    command.metadata !== undefined &&
    Object.entries(command.metadata).some(
      ([key, value]) => key.trim().length === 0 || typeof value !== "string",
    )
  ) {
    throw commandError(
      "timeline.clip.metadata-invalid",
      "Clip metadata requires non-empty keys and string values.",
    );
  }
  const updated: ClipSnapshot = {
    ...clip,
    ...(command.name === undefined ? {} : { name: command.name }),
    ...(command.metadata === undefined
      ? {}
      : {
          metadata:
            command.metadataMode === "replace"
              ? { ...command.metadata }
              : { ...clip.metadata, ...command.metadata },
        }),
  };
  return result(
    { ...timeline, clips: { ...timeline.clips, [clip.id]: updated } },
    timeline,
    command.name === undefined ? "Update clip metadata" : "Rename clip",
    `Updated user-visible clip metadata for ${clip.id}.`,
    [clip.id],
  );
};

const applyUpdateClipProperties = (
  timeline: TimelineSnapshotV1,
  command: UpdateClipPropertiesCommand,
): TimelineEditResult => {
  const clipIds = uniqueIds(command.clipIds);
  const changes = Object.entries(command.changes);
  if (clipIds.length === 0 || changes.length === 0) {
    throw commandError(
      "timeline.clip-properties.update-empty",
      "Property updates require at least one clip and one property change.",
    );
  }
  const clipsToUpdate = clipIds.map((clipId) => {
    const clip = requireClip(timeline, clipId);
    assertTrackWritable(timeline, clip.trackId);
    const properties = clip.properties ?? {};
    for (const [propertyPath, value] of changes) {
      const property = properties[propertyPath];
      if (property === undefined) {
        throw commandError(
          "timeline.clip-property.unknown",
          `Clip ${clip.id} does not declare property ${propertyPath}.`,
        );
      }
      if (!property.safeToEdit) {
        throw commandError(
          "timeline.clip-property.read-only",
          `Property ${propertyPath} is not validated for editing on ${clip.id}.`,
        );
      }
      assertPropertyValue(propertyPath, property, value);
    }
    return clip;
  });
  const clips = { ...timeline.clips };
  for (const clip of clipsToUpdate) {
    const properties = { ...(clip.properties ?? {}) };
    for (const [propertyPath, value] of changes) {
      const property = properties[propertyPath];
      if (property === undefined) throw new Error(`Validated property disappeared: ${propertyPath}.`);
      properties[propertyPath] = { ...property, value };
    }
    clips[clip.id] = { ...clip, properties };
  }
  return result(
    { ...timeline, clips },
    timeline,
    clipIds.length === 1 ? "Update clip property" : "Update shared clip properties",
    `Updated ${String(changes.length)} validated property value(s) across ${String(clipIds.length)} clip(s).`,
    clipIds,
  );
};

const applyConvertClipPropertiesToShared = (
  timeline: TimelineSnapshotV1,
  command: ConvertClipPropertiesToSharedCommand,
): TimelineEditResult => {
  const clipIds = uniqueIds(command.clipIds);
  const propertyPaths = [...new Set(command.propertyPaths)];
  if (clipIds.length === 0 || propertyPaths.length === 0) {
    throw commandError(
      "timeline.clip-properties.convert-empty",
      "Shared conversion requires at least one clip and one property path.",
    );
  }
  const clips = { ...timeline.clips };
  for (const clipId of clipIds) {
    const clip = requireClip(timeline, clipId);
    assertTrackWritable(timeline, clip.trackId);
    const properties = { ...(clip.properties ?? {}) };
    for (const propertyPath of propertyPaths) {
      const property = properties[propertyPath];
      if (property === undefined) {
        throw commandError(
          "timeline.clip-property.unknown",
          `Clip ${clip.id} does not declare property ${propertyPath}.`,
        );
      }
      if (!property.supportsSharedConversion) {
        throw commandError(
          "timeline.clip-property.conversion-unsupported",
          `Property ${propertyPath} cannot be converted from native animation on ${clip.id}.`,
        );
      }
      properties[propertyPath] = {
        ...property,
        ownership: "shared",
        safeToEdit: true,
        nativeAnimation: false,
      };
    }
    clips[clip.id] = { ...clip, properties };
  }
  return result(
    { ...timeline, clips },
    timeline,
    "Convert native animation to shared keyframes",
    `Transferred ${String(propertyPaths.length)} property owner(s) to shared Chai Studio authority.`,
    clipIds,
  );
};

const applyAddMarker = (timeline: TimelineSnapshotV1, command: AddMarkerCommand): TimelineEditResult => {
  if (timeline.markers[command.marker.id] !== undefined) {
    throw commandError("timeline.marker.id-exists", `Marker ID already exists: ${command.marker.id}.`);
  }
  const snapshot = assertValidTimelineCore({
    ...timeline,
    markers: { ...timeline.markers, [command.marker.id]: command.marker },
  });
  return result(
    snapshot,
    timeline,
    "Add marker",
    `Added ${command.marker.category} marker at frame ${String(command.marker.frame)}.`,
    [command.marker.id],
  );
};

const applyUpdateMarker = (
  timeline: TimelineSnapshotV1,
  command: UpdateMarkerCommand,
): TimelineEditResult => {
  const marker = requireMarker(timeline, command.markerId);
  if (Object.keys(command.changes).length === 0) {
    throw commandError("timeline.marker.update-empty", "Marker update has no changes.");
  }
  const updated: MarkerSnapshot = { ...marker, ...command.changes };
  const snapshot = assertValidTimelineCore({
    ...timeline,
    markers: { ...timeline.markers, [marker.id]: updated },
  });
  return result(
    snapshot,
    timeline,
    "Update marker",
    `Updated marker ${marker.id} at exact frame ${String(updated.frame)}.`,
    [marker.id],
  );
};

const applyRemoveMarkers = (
  timeline: TimelineSnapshotV1,
  command: RemoveMarkersCommand,
): TimelineEditResult => {
  const markerIds = uniqueIds(command.markerIds);
  if (markerIds.length === 0) {
    throw commandError("timeline.marker.remove-empty", "Marker removal has no IDs.");
  }
  markerIds.forEach((id) => {
    requireMarker(timeline, id);
  });
  const removing = new Set(markerIds);
  const markers = Object.fromEntries(
    Object.values(timeline.markers)
      .filter((marker) => !removing.has(marker.id))
      .map((marker) => [marker.id, marker]),
  ) as Readonly<TimelineSnapshotV1["markers"]>;
  return result(
    { ...timeline, markers },
    timeline,
    markerIds.length === 1 ? "Remove marker" : "Remove markers",
    `Removed ${String(markerIds.length)} stable marker(s).`,
    markerIds,
  );
};

const applyAddAutomationLane = (
  timeline: TimelineSnapshotV1,
  command: AddAutomationLaneCommand,
): TimelineEditResult => {
  if (timeline.automation[command.lane.id] !== undefined) {
    throw commandError(
      "timeline.automation.id-exists",
      `Automation lane already exists: ${command.lane.id}.`,
    );
  }
  if (command.lane.keyframeIds.length > 0) {
    throw commandError("timeline.automation.add-with-keyframes", "A new automation lane must begin empty.");
  }
  assertEntityExists(timeline, command.lane.ownerEntityId);
  const snapshot = assertValidTimelineCore({
    ...timeline,
    automation: { ...timeline.automation, [command.lane.id]: command.lane },
  });
  return result(
    snapshot,
    timeline,
    "Add automation lane",
    `Added ${command.lane.propertyPath} automation for ${command.lane.ownerEntityId}.`,
    [command.lane.id],
  );
};

const applyRemoveAutomationLanes = (
  timeline: TimelineSnapshotV1,
  command: RemoveAutomationLanesCommand,
): TimelineEditResult => {
  const laneIds = uniqueIds(command.laneIds);
  if (laneIds.length === 0) {
    throw commandError("timeline.automation.remove-empty", "Automation lane removal has no IDs.");
  }
  const lanes = laneIds.map((id) => requireAutomationLane(timeline, id));
  const keyframeIds = uniqueIds(lanes.flatMap((lane) => lane.keyframeIds));
  if (keyframeIds.length > 0 && !command.removeKeyframes) {
    throw commandError(
      "timeline.automation.not-empty",
      "Automation lane removal requires explicit keyframe removal intent.",
    );
  }
  const removing = new Set(laneIds);
  let working = command.removeKeyframes ? removeKeyframes(timeline, keyframeIds) : timeline;
  const automation = Object.fromEntries(
    Object.values(working.automation)
      .filter((lane) => !removing.has(lane.id))
      .map((lane) => [lane.id, lane]),
  ) as Readonly<TimelineSnapshotV1["automation"]>;
  working = { ...working, automation };
  return result(
    working,
    timeline,
    laneIds.length === 1 ? "Remove automation lane" : "Remove automation lanes",
    `Removed ${String(laneIds.length)} automation lane(s)${keyframeIds.length > 0 ? ` and ${String(keyframeIds.length)} keyframe(s)` : ""}.`,
    [...laneIds, ...keyframeIds],
  );
};

const applyAddKeyframe = (timeline: TimelineSnapshotV1, command: AddKeyframeCommand): TimelineEditResult => {
  if (timeline.keyframes[command.keyframe.id] !== undefined) {
    throw commandError("timeline.keyframe.id-exists", `Keyframe already exists: ${command.keyframe.id}.`);
  }
  assertEntityExists(timeline, command.keyframe.ownerEntityId);
  let clips = timeline.clips;
  let automation = timeline.automation;
  const ownerClip = timeline.clips[command.keyframe.ownerEntityId];
  if (ownerClip !== undefined) {
    clips = {
      ...timeline.clips,
      [ownerClip.id]: { ...ownerClip, keyframeIds: [...ownerClip.keyframeIds, command.keyframe.id] },
    };
  }
  if (command.automationLaneId !== null) {
    const lane = requireAutomationLane(timeline, command.automationLaneId);
    if (
      lane.ownerEntityId !== command.keyframe.ownerEntityId ||
      lane.propertyPath !== command.keyframe.propertyPath
    ) {
      throw commandError(
        "timeline.keyframe.lane-mismatch",
        "Keyframe owner and property must match its automation lane.",
      );
    }
    automation = {
      ...timeline.automation,
      [lane.id]: { ...lane, keyframeIds: [...lane.keyframeIds, command.keyframe.id] },
    };
  } else if (ownerClip === undefined) {
    throw commandError(
      "timeline.keyframe.relation-missing",
      "A non-clip keyframe requires an explicit automation lane relation.",
    );
  }
  const snapshot = assertValidTimelineCore({
    ...timeline,
    clips,
    automation,
    keyframes: { ...timeline.keyframes, [command.keyframe.id]: command.keyframe },
  });
  return result(
    snapshot,
    timeline,
    "Add keyframe",
    `Added ${command.keyframe.propertyPath} keyframe at frame ${String(command.keyframe.frame)}.`,
    [command.keyframe.id, command.keyframe.ownerEntityId],
  );
};

const applyAddKeyframes = (
  timeline: TimelineSnapshotV1,
  command: AddKeyframesCommand,
): TimelineEditResult => {
  if (command.entries.length === 0) {
    throw commandError("timeline.keyframe.add-empty", "Batch keyframe add has no entries.");
  }
  const ids = command.entries.map((entry) => entry.keyframe.id);
  if (new Set(ids).size !== ids.length) {
    throw commandError("timeline.keyframe.batch-duplicate", "Batch keyframe IDs must be unique.");
  }
  let working = timeline;
  const affected = new Set<StableEntityId>();
  for (const entry of command.entries) {
    const edit = applyAddKeyframe(working, {
      kind: "keyframe.add",
      keyframe: entry.keyframe,
      automationLaneId: entry.automationLaneId,
    });
    working = edit.snapshot;
    edit.affectedEntityIds.forEach((id) => affected.add(id));
  }
  return result(
    working,
    timeline,
    command.entries.length === 1 ? "Add keyframe" : "Add keyframes",
    `Added ${String(command.entries.length)} deterministic keyframe(s).`,
    [...affected],
  );
};

const applyUpdateKeyframe = (
  timeline: TimelineSnapshotV1,
  command: UpdateKeyframeCommand,
): TimelineEditResult => {
  const keyframe = requireKeyframe(timeline, command.keyframeId);
  if (Object.keys(command.changes).length === 0) {
    throw commandError("timeline.keyframe.update-empty", "Keyframe update has no changes.");
  }
  const updated: KeyframeSnapshot = { ...keyframe, ...command.changes };
  const snapshot = assertValidTimelineCore({
    ...timeline,
    keyframes: { ...timeline.keyframes, [keyframe.id]: updated },
  });
  return result(
    snapshot,
    timeline,
    "Update keyframe",
    `Updated ${keyframe.propertyPath} keyframe at frame ${String(updated.frame)}.`,
    [keyframe.id, keyframe.ownerEntityId],
  );
};

const applyUpdateKeyframes = (
  timeline: TimelineSnapshotV1,
  command: UpdateKeyframesCommand,
): TimelineEditResult => {
  if (command.updates.length === 0) {
    throw commandError("timeline.keyframe.update-empty", "Batch keyframe update has no entries.");
  }
  const ids = command.updates.map((update) => update.keyframeId);
  if (new Set(ids).size !== ids.length) {
    throw commandError("timeline.keyframe.batch-duplicate", "Batch keyframe updates must use unique IDs.");
  }
  let working = timeline;
  const affected = new Set<StableEntityId>();
  for (const update of command.updates) {
    const edit = applyUpdateKeyframe(working, {
      kind: "keyframe.update",
      keyframeId: update.keyframeId,
      changes: update.changes,
    });
    working = edit.snapshot;
    edit.affectedEntityIds.forEach((id) => affected.add(id));
  }
  return result(
    working,
    timeline,
    command.updates.length === 1 ? "Update keyframe" : "Update keyframes",
    `Updated ${String(command.updates.length)} deterministic keyframe(s) atomically.`,
    [...affected],
  );
};

const applyRemoveKeyframes = (
  timeline: TimelineSnapshotV1,
  command: RemoveKeyframesCommand,
): TimelineEditResult => {
  const keyframeIds = uniqueIds(command.keyframeIds);
  if (keyframeIds.length === 0) {
    throw commandError("timeline.keyframe.remove-empty", "Keyframe removal has no IDs.");
  }
  keyframeIds.forEach((id) => {
    requireKeyframe(timeline, id);
  });
  return result(
    removeKeyframes(timeline, keyframeIds),
    timeline,
    keyframeIds.length === 1 ? "Remove keyframe" : "Remove keyframes",
    `Removed ${String(keyframeIds.length)} stable keyframe(s) and their relations.`,
    keyframeIds,
  );
};

const result = (
  snapshot: TimelineSnapshotV1,
  inverseSnapshot: TimelineSnapshotV1,
  label: string,
  diffSummary: string,
  affectedEntityIds: readonly StableEntityId[],
): TimelineEditResult => {
  const validated = assertValidTimelineCore(snapshot);
  return {
    snapshot: validated,
    inverse: { kind: "timeline.restore", snapshot: inverseSnapshot, reason: `Undo ${label.toLowerCase()}.` },
    label,
    diffSummary,
    affectedEntityIds: uniqueIds(affectedEntityIds),
    diff: diffTimelineSnapshots(inverseSnapshot, validated),
  };
};

const finalizeClipMutation = (
  timeline: TimelineSnapshotV1,
  selectedIds: readonly StableEntityId[],
): TimelineSnapshotV1 => {
  const tracks = Object.fromEntries(
    Object.values(timeline.tracks).map((track) => [
      track.id,
      {
        ...track,
        clipIds: Object.values(timeline.clips)
          .filter((clip) => clip.trackId === track.id)
          .sort((left, right) =>
            left.range.start < right.range.start
              ? -1
              : left.range.start > right.range.start
                ? 1
                : left.id.localeCompare(right.id, "en"),
          )
          .map((clip) => clip.id),
      },
    ]),
  ) as Readonly<TimelineSnapshotV1["tracks"]>;
  const clipEnd = Object.values(timeline.clips).reduce(
    (maximum, clip) => (clip.range.end > maximum ? clip.range.end : maximum),
    masterFrame(0n),
  );
  const duration = clipEnd > timeline.duration ? clipEnd : timeline.duration;
  const selected = uniqueIds(selectedIds).sort((left, right) => left.localeCompare(right, "en"));
  return assertValidTimelineCore({
    ...timeline,
    tracks,
    duration,
    selection: {
      primaryId: selected[0] ?? null,
      selectedIds: selected,
      anchorId: selected[0] ?? null,
    },
  });
};

const normalizeTrackOrder = (timeline: TimelineSnapshotV1): TimelineSnapshotV1 => {
  const tracks = Object.fromEntries(
    timeline.trackIds.map((id, order) => {
      const track = requireTrack(timeline, id);
      return [id, { ...track, order }];
    }),
  ) as Readonly<TimelineSnapshotV1["tracks"]>;
  return assertValidTimelineCore({ ...timeline, tracks });
};

const removeClipRelations = (
  timeline: TimelineSnapshotV1,
  clipIds: readonly StableEntityId[],
): TimelineSnapshotV1 => {
  const removing = new Set(clipIds);
  const tracks = Object.fromEntries(
    Object.values(timeline.tracks).map((track) => [
      track.id,
      { ...track, clipIds: track.clipIds.filter((id) => !removing.has(id)) },
    ]),
  ) as Readonly<TimelineSnapshotV1["tracks"]>;
  return { ...timeline, tracks };
};

const removeKeyframes = (
  timeline: TimelineSnapshotV1,
  keyframeIds: readonly StableEntityId[],
): TimelineSnapshotV1 => {
  const removing = new Set(keyframeIds);
  const keyframes = Object.fromEntries(
    Object.values(timeline.keyframes)
      .filter((keyframe) => !removing.has(keyframe.id))
      .map((keyframe) => [keyframe.id, keyframe]),
  ) as Readonly<TimelineSnapshotV1["keyframes"]>;
  const clips = Object.fromEntries(
    Object.values(timeline.clips).map((clip) => [
      clip.id,
      { ...clip, keyframeIds: clip.keyframeIds.filter((id) => !removing.has(id)) },
    ]),
  ) as Readonly<TimelineSnapshotV1["clips"]>;
  const automation = Object.fromEntries(
    Object.values(timeline.automation).map((lane) => [
      lane.id,
      { ...lane, keyframeIds: lane.keyframeIds.filter((id) => !removing.has(id)) },
    ]),
  ) as Readonly<TimelineSnapshotV1["automation"]>;
  return { ...timeline, keyframes, clips, automation };
};

const removeClips = (
  timeline: TimelineSnapshotV1,
  clipIds: readonly StableEntityId[],
): TimelineSnapshotV1 => {
  const removing = new Set(clipIds);
  const removedKeyframeIds = new Set(
    Object.values(timeline.keyframes)
      .filter((keyframe) => removing.has(keyframe.ownerEntityId))
      .map((keyframe) => keyframe.id),
  );
  for (const clipId of clipIds) {
    const clip = timeline.clips[clipId];
    clip?.keyframeIds.forEach((id) => removedKeyframeIds.add(id));
  }
  const removedTransitionIds = new Set(
    Object.values(timeline.transitions)
      .filter((transition) => removing.has(transition.fromClipId) || removing.has(transition.toClipId))
      .map((transition) => transition.id),
  );
  const clips = Object.fromEntries(
    Object.values(timeline.clips)
      .filter((clip) => !removing.has(clip.id))
      .map((clip) => [
        clip.id,
        {
          ...clip,
          transitionInId:
            clip.transitionInId !== null && removedTransitionIds.has(clip.transitionInId)
              ? null
              : clip.transitionInId,
          transitionOutId:
            clip.transitionOutId !== null && removedTransitionIds.has(clip.transitionOutId)
              ? null
              : clip.transitionOutId,
        },
      ]),
  ) as Readonly<TimelineSnapshotV1["clips"]>;
  const transitions = Object.fromEntries(
    Object.values(timeline.transitions)
      .filter((transition) => !removedTransitionIds.has(transition.id))
      .map((transition) => [transition.id, transition]),
  ) as Readonly<TimelineSnapshotV1["transitions"]>;
  const keyframes = Object.fromEntries(
    Object.values(timeline.keyframes)
      .filter((keyframe) => !removedKeyframeIds.has(keyframe.id))
      .map((keyframe) => [keyframe.id, keyframe]),
  ) as Readonly<TimelineSnapshotV1["keyframes"]>;
  const automation = Object.fromEntries(
    Object.values(timeline.automation)
      .filter((lane) => !removing.has(lane.ownerEntityId))
      .map((lane) => [
        lane.id,
        {
          ...lane,
          keyframeIds: lane.keyframeIds.filter((id) => !removedKeyframeIds.has(id)),
        },
      ]),
  ) as Readonly<TimelineSnapshotV1["automation"]>;
  const bridges = Object.fromEntries(
    Object.values(timeline.bridges)
      .filter((bridge) => !removing.has(bridge.fromEntityId) && !removing.has(bridge.toEntityId))
      .map((bridge) => [bridge.id, bridge]),
  ) as Readonly<TimelineSnapshotV1["bridges"]>;
  return removeClipRelations({ ...timeline, clips, transitions, keyframes, automation, bridges }, clipIds);
};

const assertLinkedCoverage = (
  timeline: TimelineSnapshotV1,
  affectedClipIds: readonly StableEntityId[],
): void => {
  const affected = new Set(affectedClipIds);
  for (const clipId of affected) {
    const clip = requireClip(timeline, clipId);
    if (clip.linkGroupId === null) continue;
    const missing = Object.values(timeline.clips).filter(
      (candidate) => candidate.linkGroupId === clip.linkGroupId && !affected.has(candidate.id),
    );
    if (missing.length > 0) {
      throw commandError(
        "timeline.link.coverage-incomplete",
        `Edit of ${clip.id} omits linked clip(s): ${missing.map((item) => item.id).join(", ")}.`,
      );
    }
  }
};

const assertLinkedCoverageAtFrame = (
  timeline: TimelineSnapshotV1,
  affectedClipIds: readonly StableEntityId[],
  atFrame: MasterFrame,
): void => {
  const affected = new Set(affectedClipIds);
  for (const clipId of affected) {
    const clip = requireClip(timeline, clipId);
    if (clip.linkGroupId === null) continue;
    const missing = Object.values(timeline.clips).filter(
      (candidate) =>
        candidate.linkGroupId === clip.linkGroupId &&
        candidate.range.start < atFrame &&
        atFrame < candidate.range.end &&
        !affected.has(candidate.id),
    );
    if (missing.length > 0) {
      throw commandError(
        "timeline.link.coverage-incomplete",
        `Split of ${clip.id} omits linked clip(s): ${missing.map((item) => item.id).join(", ")}.`,
      );
    }
  }
};

const rangeContains = (outer: FrameRange, inner: FrameRange): boolean =>
  inner.start >= outer.start && inner.end <= outer.end;

const mergeRanges = (ranges: readonly FrameRange[]): readonly FrameRange[] => {
  const sorted = [...ranges].sort((left, right) =>
    left.start < right.start ? -1 : left.start > right.start ? 1 : 0,
  );
  const merged: FrameRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || previous.end < range.start) {
      merged.push(range);
    } else {
      merged[merged.length - 1] = {
        start: previous.start,
        end: previous.end > range.end ? previous.end : range.end,
      };
    }
  }
  return merged;
};

const shiftContentMarkers = (
  markers: TimelineSnapshotV1["markers"],
  boundary: MasterFrame,
  delta: MasterFrame,
): TimelineSnapshotV1["markers"] =>
  Object.fromEntries(
    Object.values(markers).map((marker) => [
      marker.id,
      marker.ripplePolicy === "anchored-content" && marker.frame >= boundary
        ? { ...marker, frame: masterFrame(marker.frame + delta) }
        : marker,
    ]),
  );

const shiftOwnedKeyframes = (
  keyframes: TimelineSnapshotV1["keyframes"],
  ownerIds: readonly StableEntityId[],
  delta: MasterFrame,
): TimelineSnapshotV1["keyframes"] => {
  if (delta === 0n) return keyframes;
  const owners = new Set(ownerIds);
  return Object.fromEntries(
    Object.values(keyframes).map((keyframe) => [
      keyframe.id,
      owners.has(keyframe.ownerEntityId)
        ? { ...keyframe, frame: masterFrame(keyframe.frame + delta) }
        : keyframe,
    ]),
  );
};

const rippleDeleteContentMarkers = (
  markers: TimelineSnapshotV1["markers"],
  deletedRanges: readonly FrameRange[],
): TimelineSnapshotV1["markers"] =>
  Object.fromEntries(
    Object.values(markers).flatMap((marker) => {
      if (marker.ripplePolicy === "anchored-time") return [[marker.id, marker] as const];
      if (deletedRanges.some((range) => marker.frame >= range.start && marker.frame < range.end)) {
        return [];
      }
      const shift = deletedRanges.reduce(
        (total, range) => (range.end <= marker.frame ? total + frameRangeDuration(range) : total),
        0n,
      );
      return [
        [marker.id, shift === 0n ? marker : { ...marker, frame: masterFrame(marker.frame - shift) }] as const,
      ];
    }),
  );

const assertPlacement = (
  issues: readonly Readonly<{ code: string; message: string }>[],
  clipId: StableEntityId,
): void => {
  const first = issues[0];
  if (first !== undefined) throw commandError(first.code, `${clipId}: ${first.message}`);
};

const timelineForPlacement = (timeline: TimelineSnapshotV1, clip: ClipSnapshot): TimelineSnapshotV1 => ({
  ...timeline,
  duration: clip.range.end > timeline.duration ? clip.range.end : timeline.duration,
});

const assertNewClipId = (timeline: TimelineSnapshotV1, clipId: StableEntityId): void => {
  if (timeline.clips[clipId] !== undefined) {
    throw commandError("timeline.clip.id-exists", `Clip ID already exists: ${clipId}.`);
  }
};

const assertTrackWritable = (timeline: TimelineSnapshotV1, trackId: StableEntityId): void => {
  const track = requireTrack(timeline, trackId);
  if (track.locked) throw commandError("timeline.track.locked", `Track ${trackId} is locked.`);
};

const assertPropertyValue = (
  propertyPath: string,
  property: NonNullable<ClipSnapshot["properties"]>[string],
  value: TimelinePropertyValue,
): void => {
  const expected = property.defaultValue;
  const sameShape = Array.isArray(expected)
    ? Array.isArray(value) && value.length === expected.length
    : typeof value === typeof expected && !Array.isArray(value);
  const numericValues = typeof value === "number" ? [value] : Array.isArray(value) ? value : [];
  const finite = numericValues.every((item) => Number.isFinite(item));
  const bounded = numericValues.every(
    (item) =>
      (property.minimum === null || item >= property.minimum) &&
      (property.maximum === null || item <= property.maximum),
  );
  if (propertyPath.trim().length === 0 || !sameShape || !finite || !bounded) {
    throw commandError(
      "timeline.clip-property.value-invalid",
      `Property ${propertyPath} value does not match its declared type or bounds.`,
    );
  }
};

const requireTrack = (timeline: TimelineSnapshotV1, trackId: StableEntityId) => {
  const track = timeline.tracks[trackId];
  if (track === undefined) throw commandError("timeline.track.unknown", `Unknown track: ${trackId}.`);
  return track;
};

const requireClip = (timeline: TimelineSnapshotV1, clipId: StableEntityId): ClipSnapshot => {
  const clip = timeline.clips[clipId];
  if (clip === undefined) throw commandError("timeline.clip.unknown", `Unknown clip: ${clipId}.`);
  return clip;
};

const requireMarker = (timeline: TimelineSnapshotV1, markerId: StableEntityId): MarkerSnapshot => {
  const marker = timeline.markers[markerId];
  if (marker === undefined) {
    throw commandError("timeline.marker.unknown", `Unknown marker: ${markerId}.`);
  }
  return marker;
};

const requireKeyframe = (timeline: TimelineSnapshotV1, keyframeId: StableEntityId): KeyframeSnapshot => {
  const keyframe = timeline.keyframes[keyframeId];
  if (keyframe === undefined) {
    throw commandError("timeline.keyframe.unknown", `Unknown keyframe: ${keyframeId}.`);
  }
  return keyframe;
};

const requireAutomationLane = (
  timeline: TimelineSnapshotV1,
  laneId: StableEntityId,
): AutomationLaneSnapshot => {
  const lane = timeline.automation[laneId];
  if (lane === undefined) {
    throw commandError("timeline.automation.unknown", `Unknown automation lane: ${laneId}.`);
  }
  return lane;
};

const assertEntityExists = (timeline: TimelineSnapshotV1, id: StableEntityId): void => {
  if (!allEntityIds(timeline).includes(id)) {
    throw commandError("timeline.selection.entity-unknown", `Unknown selectable entity: ${id}.`);
  }
};

const allEntityIds = (timeline: TimelineSnapshotV1): readonly StableEntityId[] => [
  timeline.id,
  ...Object.keys(timeline.tracks).map((id) => id as StableEntityId),
  ...Object.keys(timeline.audioBuses).map((id) => id as StableEntityId),
  ...Object.keys(timeline.clips).map((id) => id as StableEntityId),
  ...Object.keys(timeline.nestedSequences).map((id) => id as StableEntityId),
  ...Object.keys(timeline.keyframes).map((id) => id as StableEntityId),
  ...Object.keys(timeline.markers).map((id) => id as StableEntityId),
  ...Object.keys(timeline.transitions).map((id) => id as StableEntityId),
  ...Object.keys(timeline.bridges).map((id) => id as StableEntityId),
  ...Object.keys(timeline.captions).map((id) => id as StableEntityId),
  ...Object.keys(timeline.automation).map((id) => id as StableEntityId),
];

const uniqueIds = (ids: readonly StableEntityId[]): StableEntityId[] => [...new Set(ids)];

const commandError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "timeline",
    code,
    correlationId: createCorrelationId(),
    stage: "timeline-edit-command",
    message,
    repairHint: "Refresh selection and placement, respect locked tracks, and retry with stable entity IDs.",
  });
