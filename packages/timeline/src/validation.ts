import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { compareRationals } from "@chai-studio/schema/rational";
import { frameRangeDuration, frameRangesOverlap, type FrameRange } from "./range.js";
import type {
  ClipSnapshot,
  StableEntityId,
  TimelinePropertyValue,
  TimelineSnapshotV1,
  TimelineTrackKind,
  TrackSnapshot,
} from "./model.js";

export interface TimelineValidationIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly entityId: StableEntityId;
  readonly path: string;
  readonly message: string;
  readonly repairHint: string;
  readonly conflictingEntityIds: readonly StableEntityId[];
}

export interface TimelineValidationReport {
  readonly passed: boolean;
  readonly issues: readonly TimelineValidationIssue[];
}

export interface ClipPlacementReport {
  readonly allowed: boolean;
  readonly issues: readonly TimelineValidationIssue[];
}

export const validateTimelineCore = (timeline: TimelineSnapshotV1): TimelineValidationReport => {
  const issues: TimelineValidationIssue[] = [];
  validateTrackRegistry(timeline, issues);
  validateAudioBusRegistry(timeline, issues);
  validateClipRegistry(timeline, issues);
  validateNestedSequences(timeline, issues);
  validateTransitions(timeline, issues);
  validateMarkers(timeline, issues);
  validateKeyframesAndAutomation(timeline, issues);
  return { passed: !issues.some((item) => item.severity === "error"), issues };
};

export const assertValidTimelineCore = (timeline: TimelineSnapshotV1): TimelineSnapshotV1 => {
  const report = validateTimelineCore(timeline);
  if (report.passed) return timeline;
  const first = report.issues[0];
  throw new ChaiError({
    category: "timeline",
    code: first?.code ?? "timeline.validation.failed",
    correlationId: createCorrelationId(),
    stage: "timeline-core-validation",
    message: first?.message ?? "Timeline validation failed.",
    ...(first === undefined ? {} : { entityId: first.entityId }),
    repairHint: first?.repairHint ?? "Repair timeline invariants before committing.",
    details: { issues: report.issues },
  });
};

export const validateClipPlacement = (
  timeline: TimelineSnapshotV1,
  candidate: ClipSnapshot,
  excludeClipId: StableEntityId | null = null,
): ClipPlacementReport => {
  const issues: TimelineValidationIssue[] = [];
  validateSingleClip(timeline, candidate, issues, false);
  const track = timeline.tracks[candidate.trackId];
  if (track !== undefined && track.kind !== "audio") {
    for (const clipId of track.clipIds) {
      if (clipId === excludeClipId || clipId === candidate.id) continue;
      const existing = timeline.clips[clipId];
      if (existing !== undefined && frameRangesOverlap(existing.range, candidate.range)) {
        issues.push(
          issue(
            "timeline.clip.overlap",
            candidate.id,
            `/clips/${candidate.id}/range`,
            `Clip overlaps ${existing.id} on non-audio track ${track.id}.`,
            "Move, trim, overwrite, or place the clip on another compatible track.",
            [existing.id, track.id],
          ),
        );
      }
    }
  }
  return { allowed: !issues.some((item) => item.severity === "error"), issues };
};

export const orderedTracks = (
  timeline: TimelineSnapshotV1,
  kind?: TimelineTrackKind,
): readonly TrackSnapshot[] =>
  timeline.trackIds
    .map((id) => timeline.tracks[id])
    .filter(
      (track): track is TrackSnapshot => track !== undefined && (kind === undefined || track.kind === kind),
    )
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, "en"));

export const visualStack = (timeline: TimelineSnapshotV1): readonly TrackSnapshot[] =>
  orderedTracks(timeline, "video").filter((track) => !track.hidden);

export const audibleTracks = (timeline: TimelineSnapshotV1): readonly TrackSnapshot[] => {
  const tracks = orderedTracks(timeline, "audio").filter((track) => !track.muted);
  const solo = tracks.filter((track) => track.solo);
  return solo.length > 0 ? solo : tracks;
};

export const orderedAudioBuses = (timeline: TimelineSnapshotV1) =>
  timeline.audioBusIds
    .map((id) => timeline.audioBuses[id])
    .filter((bus): bus is NonNullable<typeof bus> => bus !== undefined)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, "en"));

const validateTrackRegistry = (timeline: TimelineSnapshotV1, issues: TimelineValidationIssue[]): void => {
  registryAgreement(timeline.id, "tracks", timeline.trackIds, timeline.tracks, issues);
  duplicateValues(timeline.trackIds).forEach((id) =>
    issues.push(
      issue(
        "timeline.track.id-duplicate",
        id,
        "/trackIds",
        "Track ID is duplicated.",
        "Keep each stable track ID once.",
        [],
      ),
    ),
  );
  duplicateValues(Object.values(timeline.tracks).map((track) => track.order)).forEach((order) =>
    issues.push(
      issue(
        "timeline.track.order-duplicate",
        timeline.id,
        "/tracks",
        `Track order ${String(order)} is duplicated.`,
        "Assign every track a unique deterministic integer order.",
        [],
      ),
    ),
  );
  for (const [id, track] of Object.entries(timeline.tracks)) {
    if (track.id !== id) {
      issues.push(
        issue(
          "timeline.track.id-mismatch",
          track.id,
          `/tracks/${id}/id`,
          "Track map key and ID disagree.",
          "Key tracks by their stable ID.",
          [],
        ),
      );
    }
    if (!Number.isSafeInteger(track.order) || track.order < 0) {
      issues.push(
        issue(
          "timeline.track.order-invalid",
          track.id,
          `/tracks/${id}/order`,
          "Track order must be a non-negative safe integer.",
          "Assign a bounded integer order.",
          [],
        ),
      );
    }
    if (track.kind === "audio" && track.audioBusId === null) {
      issues.push(
        issue(
          "timeline.track.audio-bus-missing",
          track.id,
          `/tracks/${id}/audioBusId`,
          "Audio track has no output bus.",
          "Route the track to an ordered audio bus.",
          [],
        ),
      );
    }
    if (track.kind !== "audio" && track.audioBusId !== null) {
      issues.push(
        issue(
          "timeline.track.audio-bus-forbidden",
          track.id,
          `/tracks/${id}/audioBusId`,
          "Non-audio track cannot own an audio bus route.",
          "Clear audioBusId or change the track type.",
          [],
        ),
      );
    }
  }
};

const validateAudioBusRegistry = (timeline: TimelineSnapshotV1, issues: TimelineValidationIssue[]): void => {
  registryAgreement(timeline.id, "audioBuses", timeline.audioBusIds, timeline.audioBuses, issues);
  duplicateValues(Object.values(timeline.audioBuses).map((bus) => bus.order)).forEach((order) =>
    issues.push(
      issue(
        "timeline.audio-bus.order-duplicate",
        timeline.id,
        "/audioBuses",
        `Audio bus order ${String(order)} is duplicated.`,
        "Assign unique bus order values.",
        [],
      ),
    ),
  );
  for (const track of Object.values(timeline.tracks)) {
    if (track.audioBusId !== null && timeline.audioBuses[track.audioBusId] === undefined) {
      issues.push(
        issue(
          "timeline.track.audio-bus-unknown",
          track.id,
          `/tracks/${track.id}/audioBusId`,
          "Track references an unknown audio bus.",
          "Route to an existing stable audio bus ID.",
          [track.audioBusId],
        ),
      );
    }
  }
};

const validateClipRegistry = (timeline: TimelineSnapshotV1, issues: TimelineValidationIssue[]): void => {
  const listedClipIds = Object.values(timeline.tracks).flatMap((track) => track.clipIds);
  registryAgreement(timeline.id, "clips", listedClipIds, timeline.clips, issues);
  duplicateValues(listedClipIds).forEach((id) =>
    issues.push(
      issue(
        "timeline.clip.listed-multiple",
        id,
        "/tracks",
        "Clip is listed by multiple track relationships.",
        "Keep one owning trackId and one clipIds entry.",
        [],
      ),
    ),
  );
  for (const clip of Object.values(timeline.clips)) {
    validateSingleClip(timeline, clip, issues, true);
    const placement = validateClipPlacement(timeline, clip, clip.id);
    issues.push(...placement.issues.filter((item) => item.code === "timeline.clip.overlap"));
  }
};

const validateSingleClip = (
  timeline: TimelineSnapshotV1,
  clip: ClipSnapshot,
  issues: TimelineValidationIssue[],
  requireTrackRelation: boolean,
): void => {
  const track = timeline.tracks[clip.trackId];
  if (track === undefined) {
    issues.push(
      issue(
        "timeline.clip.track-unknown",
        clip.id,
        `/clips/${clip.id}/trackId`,
        "Clip references an unknown track.",
        "Assign an existing stable track ID.",
        [clip.trackId],
      ),
    );
  } else if (requireTrackRelation && !track.clipIds.includes(clip.id)) {
    issues.push(
      issue(
        "timeline.clip.track-relation-missing",
        clip.id,
        `/tracks/${track.id}/clipIds`,
        "Owning track does not list the clip.",
        "Add the stable clip ID to its owning track relation.",
        [track.id],
      ),
    );
  }
  if (clip.range.start < 0n || clip.range.end > timeline.duration || clip.range.end <= clip.range.start) {
    issues.push(
      issue(
        "timeline.clip.range-invalid",
        clip.id,
        `/clips/${clip.id}/range`,
        "Clip range is empty or outside timeline bounds.",
        "Place a positive half-open clip range inside timeline duration.",
        [],
      ),
    );
  }
  if (clip.sourceRange.end <= clip.sourceRange.start) {
    issues.push(
      issue(
        "timeline.clip.source-range-invalid",
        clip.id,
        `/clips/${clip.id}/sourceRange`,
        "Source range must have positive duration.",
        "Choose valid source in/out frames.",
        [],
      ),
    );
  }
  if (!containsRange(clip.availableSourceRange, clip.sourceRange)) {
    issues.push(
      issue(
        "timeline.clip.handles-exceeded",
        clip.id,
        `/clips/${clip.id}/sourceRange`,
        "Source range exceeds available media handles.",
        "Trim within available source bounds or relink longer media.",
        [],
      ),
    );
  }
  if ((clip.assetId === null) === (clip.nestedSequenceId === null)) {
    issues.push(
      issue(
        "timeline.clip.source-identity-invalid",
        clip.id,
        `/clips/${clip.id}`,
        "Clip must reference exactly one asset or nested sequence.",
        "Set one stable source identity and clear the other.",
        [],
      ),
    );
  }
  try {
    if (frameRangeDuration(clip.range) <= 0n || frameRangeDuration(clip.sourceRange) <= 0n) throw new Error();
  } catch {
    issues.push(
      issue(
        "timeline.clip.duration-invalid",
        clip.id,
        `/clips/${clip.id}`,
        "Clip duration is invalid.",
        "Use bounded positive frame durations.",
        [],
      ),
    );
  }
  for (const [propertyPath, property] of Object.entries(clip.properties ?? {})) {
    const values: readonly number[] =
      typeof property.value === "number"
        ? [property.value]
        : isNumericPropertyVector(property.value)
          ? property.value
          : [];
    const defaults: readonly number[] =
      typeof property.defaultValue === "number"
        ? [property.defaultValue]
        : isNumericPropertyVector(property.defaultValue)
          ? property.defaultValue
          : [];
    const sameShape = Array.isArray(property.defaultValue)
      ? Array.isArray(property.value) && property.value.length === property.defaultValue.length
      : typeof property.value === typeof property.defaultValue && !Array.isArray(property.value);
    const validBounds =
      (property.minimum === null || Number.isFinite(property.minimum)) &&
      (property.maximum === null || Number.isFinite(property.maximum)) &&
      (property.minimum === null || property.maximum === null || property.minimum <= property.maximum) &&
      (property.step === null || (Number.isFinite(property.step) && property.step > 0));
    const numericValuesValid = [...values, ...defaults].every(
      (value) =>
        Number.isFinite(value) &&
        (property.minimum === null || value >= property.minimum) &&
        (property.maximum === null || value <= property.maximum),
    );
    if (
      propertyPath.trim().length === 0 ||
      !sameShape ||
      !validBounds ||
      !numericValuesValid ||
      (property.nativeAnimation && property.ownership !== "engine-native")
    ) {
      issues.push(
        issue(
          "timeline.clip-property.invalid",
          clip.id,
          `/clips/${clip.id}/properties/${propertyPath}`,
          "Clip property state has invalid type, bounds, value, or animation ownership.",
          "Restore the declared property contract before applying inspector edits.",
          [clip.id],
        ),
      );
    }
  }
};

const validateNestedSequences = (timeline: TimelineSnapshotV1, issues: TimelineValidationIssue[]): void => {
  for (const clip of Object.values(timeline.clips)) {
    if (clip.nestedSequenceId === null) continue;
    const nested = timeline.nestedSequences[clip.nestedSequenceId];
    if (nested === undefined) {
      issues.push(
        issue(
          "timeline.nested.unknown",
          clip.id,
          `/clips/${clip.id}/nestedSequenceId`,
          "Clip references an unknown nested sequence.",
          "Register the nested sequence by stable ID.",
          [clip.nestedSequenceId],
        ),
      );
      continue;
    }
    if (clip.sourceRange.end > nested.duration) {
      issues.push(
        issue(
          "timeline.nested.boundary-exceeded",
          clip.id,
          `/clips/${clip.id}/sourceRange`,
          "Nested clip exceeds nested sequence duration.",
          "Trim the source range to the nested boundary.",
          [nested.id],
        ),
      );
    }
    if (compareRationals(clip.sourceRate, nested.rate) !== 0) {
      issues.push(
        issue(
          "timeline.nested.rate-mismatch",
          clip.id,
          `/clips/${clip.id}/sourceRate`,
          "Nested clip source rate disagrees with the nested sequence.",
          "Use the nested sequence's exact normalized rational rate.",
          [nested.id],
        ),
      );
    }
  }
};

const validateTransitions = (timeline: TimelineSnapshotV1, issues: TimelineValidationIssue[]): void => {
  for (const transition of Object.values(timeline.transitions)) {
    const from = timeline.clips[transition.fromClipId];
    const to = timeline.clips[transition.toClipId];
    if (from === undefined || to === undefined) {
      issues.push(
        issue(
          "timeline.transition.clip-unknown",
          transition.id,
          `/transitions/${transition.id}`,
          "Transition references a missing clip.",
          "Link both transition endpoints to existing clips.",
          [transition.fromClipId, transition.toClipId],
        ),
      );
    } else if (from.trackId !== to.trackId) {
      issues.push(
        issue(
          "timeline.transition.track-mismatch",
          transition.id,
          `/transitions/${transition.id}`,
          "Transition endpoints are on different tracks.",
          "Move endpoints to one compatible track or use a bridge.",
          [from.id, to.id],
        ),
      );
    }
  }
};

const validateMarkers = (timeline: TimelineSnapshotV1, issues: TimelineValidationIssue[]): void => {
  for (const [id, marker] of Object.entries(timeline.markers)) {
    if (marker.id !== id) {
      issues.push(
        issue(
          "timeline.marker.id-mismatch",
          marker.id,
          `/markers/${id}/id`,
          "Marker map key and stable ID disagree.",
          "Key the marker record by its stable marker ID.",
          [],
        ),
      );
    }
    if (marker.frame < 0n || marker.duration < 0n || marker.frame + marker.duration > timeline.duration) {
      issues.push(
        issue(
          "timeline.marker.range-invalid",
          marker.id,
          `/markers/${id}`,
          "Marker point or duration is outside timeline bounds.",
          "Keep marker frame and non-negative duration inside timeline duration.",
          [],
        ),
      );
    }
    if (marker.label.trim().length === 0) {
      issues.push(
        issue(
          "timeline.marker.label-empty",
          marker.id,
          `/markers/${id}/label`,
          "Marker label cannot be empty.",
          "Provide a visible marker label.",
          [],
        ),
      );
    }
    if ((marker.category === "issue") !== (marker.issueSeverity !== null)) {
      issues.push(
        issue(
          "timeline.marker.issue-severity-invalid",
          marker.id,
          `/markers/${id}/issueSeverity`,
          "Only issue markers require an issue severity.",
          "Set severity for issue markers and clear it for other categories.",
          [],
        ),
      );
    }
    if (new Set(marker.annotationReferenceIds).size !== marker.annotationReferenceIds.length) {
      issues.push(
        issue(
          "timeline.marker.annotation-duplicate",
          marker.id,
          `/markers/${id}/annotationReferenceIds`,
          "Marker annotation references contain duplicates.",
          "Keep each stable annotation reference once.",
          [],
        ),
      );
    }
  }
};

const validateKeyframesAndAutomation = (
  timeline: TimelineSnapshotV1,
  issues: TimelineValidationIssue[],
): void => {
  const relatedKeyframes = new Set<StableEntityId>();
  for (const clip of Object.values(timeline.clips)) {
    duplicateValues(clip.keyframeIds).forEach((id) =>
      issues.push(
        issue(
          "timeline.keyframe.clip-relation-duplicate",
          clip.id,
          `/clips/${clip.id}/keyframeIds`,
          "Clip repeats a keyframe relation.",
          "Keep each stable keyframe ID once per clip.",
          [id],
        ),
      ),
    );
    for (const id of clip.keyframeIds) {
      relatedKeyframes.add(id);
      const keyframe = timeline.keyframes[id];
      if (keyframe?.ownerEntityId !== clip.id) {
        issues.push(
          issue(
            "timeline.keyframe.clip-relation-invalid",
            clip.id,
            `/clips/${clip.id}/keyframeIds`,
            "Clip keyframe relation is missing or owned by another entity.",
            "Relate only existing keyframes owned by this clip.",
            [id],
          ),
        );
      }
    }
  }
  for (const [id, lane] of Object.entries(timeline.automation)) {
    if (lane.id !== id || !timelineEntityExists(timeline, lane.ownerEntityId)) {
      issues.push(
        issue(
          "timeline.automation.identity-invalid",
          lane.id,
          `/automation/${id}`,
          "Automation lane ID or owner is invalid.",
          "Key the lane by stable ID and assign an existing owner entity.",
          [lane.ownerEntityId],
        ),
      );
    }
    if (lane.propertyPath.trim().length === 0) {
      issues.push(
        issue(
          "timeline.automation.property-empty",
          lane.id,
          `/automation/${id}/propertyPath`,
          "Automation property path cannot be empty.",
          "Provide a deterministic property path.",
          [],
        ),
      );
    }
    duplicateValues(lane.keyframeIds).forEach((keyframeId) =>
      issues.push(
        issue(
          "timeline.automation.keyframe-duplicate",
          lane.id,
          `/automation/${id}/keyframeIds`,
          "Automation lane repeats a keyframe relation.",
          "Keep each stable keyframe ID once.",
          [keyframeId],
        ),
      ),
    );
    for (const keyframeId of lane.keyframeIds) {
      relatedKeyframes.add(keyframeId);
      const keyframe = timeline.keyframes[keyframeId];
      if (keyframe?.ownerEntityId !== lane.ownerEntityId || keyframe.propertyPath !== lane.propertyPath) {
        issues.push(
          issue(
            "timeline.automation.keyframe-mismatch",
            lane.id,
            `/automation/${id}/keyframeIds`,
            "Automation keyframe is missing or disagrees with lane owner/property.",
            "Relate matching keyframes to the lane.",
            [keyframeId],
          ),
        );
      }
    }
  }
  for (const [id, keyframe] of Object.entries(timeline.keyframes)) {
    if (keyframe.id !== id || !timelineEntityExists(timeline, keyframe.ownerEntityId)) {
      issues.push(
        issue(
          "timeline.keyframe.identity-invalid",
          keyframe.id,
          `/keyframes/${id}`,
          "Keyframe ID or owner is invalid.",
          "Key the keyframe by stable ID and assign an existing owner.",
          [keyframe.ownerEntityId],
        ),
      );
    }
    if (!relatedKeyframes.has(keyframe.id)) {
      issues.push(
        issue(
          "timeline.keyframe.relation-missing",
          keyframe.id,
          `/keyframes/${id}`,
          "Keyframe is not reachable from its clip or automation lane.",
          "Add the keyframe ID to its authoritative owner relation.",
          [keyframe.ownerEntityId],
        ),
      );
    }
    const ownerClip = timeline.clips[keyframe.ownerEntityId];
    if (
      keyframe.frame < 0n ||
      keyframe.frame > timeline.duration ||
      (ownerClip !== undefined &&
        (keyframe.frame < ownerClip.range.start || keyframe.frame >= ownerClip.range.end))
    ) {
      issues.push(
        issue(
          "timeline.keyframe.frame-invalid",
          keyframe.id,
          `/keyframes/${id}/frame`,
          "Keyframe frame is outside its timeline or clip owner range.",
          "Move the keyframe inside its owner range.",
          [keyframe.ownerEntityId],
        ),
      );
    }
    if (keyframe.propertyPath.trim().length === 0 || !keyframeValueIsFinite(keyframe.value)) {
      issues.push(
        issue(
          "timeline.keyframe.value-invalid",
          keyframe.id,
          `/keyframes/${id}`,
          "Keyframe property path or numeric value is invalid.",
          "Provide a property path and finite scalar/vector values.",
          [],
        ),
      );
    }
    const tangentValues = [...(keyframe.inTangent ?? []), ...(keyframe.outTangent ?? [])];
    if (tangentValues.some((value) => !Number.isFinite(value))) {
      issues.push(
        issue(
          "timeline.keyframe.tangent-invalid",
          keyframe.id,
          `/keyframes/${id}`,
          "Keyframe tangent contains a non-finite value.",
          "Use finite tangent coordinates.",
          [],
        ),
      );
    }
  }
};

const timelineEntityExists = (timeline: TimelineSnapshotV1, id: StableEntityId): boolean =>
  id === timeline.id ||
  timeline.tracks[id] !== undefined ||
  timeline.audioBuses[id] !== undefined ||
  timeline.clips[id] !== undefined ||
  timeline.nestedSequences[id] !== undefined ||
  timeline.markers[id] !== undefined ||
  timeline.transitions[id] !== undefined ||
  timeline.bridges[id] !== undefined ||
  timeline.captions[id] !== undefined;

const keyframeValueIsFinite = (value: unknown): boolean =>
  typeof value === "number"
    ? Number.isFinite(value)
    : Array.isArray(value)
      ? value.every((item) => typeof item === "number" && Number.isFinite(item))
      : typeof value === "string" || typeof value === "boolean";

const registryAgreement = <T extends { readonly id: StableEntityId }>(
  timelineId: StableEntityId,
  label: string,
  ids: readonly StableEntityId[],
  records: Readonly<Record<StableEntityId, T>>,
  issues: TimelineValidationIssue[],
): void => {
  const listed = new Set(ids);
  for (const id of ids) {
    if (records[id] === undefined) {
      issues.push(
        issue(
          `timeline.${label}.record-missing`,
          id,
          `/${label}`,
          `${label} relationship references a missing record.`,
          "Restore the record or remove the stale stable ID.",
          [],
        ),
      );
    }
  }
  for (const id of Object.keys(records) as StableEntityId[]) {
    if (!listed.has(id)) {
      issues.push(
        issue(
          `timeline.${label}.relation-missing`,
          id,
          `/${label}`,
          `${label} record is not reachable from its ordered relationship.`,
          "Add the stable ID to the authoritative relationship list.",
          [timelineId],
        ),
      );
    }
  }
};

const containsRange = (outer: FrameRange, inner: FrameRange): boolean =>
  inner.start >= outer.start && inner.end <= outer.end;

const isNumericPropertyVector = (value: TimelinePropertyValue): value is readonly number[] =>
  Array.isArray(value) && value.every((item: unknown): item is number => typeof item === "number");

const duplicateValues = <T>(values: readonly T[]): readonly T[] => {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  values.forEach((value) => (seen.has(value) ? duplicates.add(value) : seen.add(value)));
  return [...duplicates];
};

const issue = (
  code: string,
  entityId: StableEntityId,
  path: string,
  message: string,
  repairHint: string,
  conflictingEntityIds: readonly StableEntityId[],
): TimelineValidationIssue => ({
  severity: "error",
  code,
  entityId,
  path,
  message,
  repairHint,
  conflictingEntityIds,
});
