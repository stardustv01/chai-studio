import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import {
  deserializeRational,
  parseBigIntString,
  type NormalizedRational,
} from "@chai-studio/schema/rational";
import type {
  AutomationLaneSnapshot,
  BridgeSnapshot,
  ClipSnapshot,
  KeyframeSnapshot,
  NestedSequenceSnapshot,
  StableEntityId,
  TimelineEngine,
  TimelineSnapshotV1,
  TransitionSnapshot,
} from "./model.js";
import {
  createFrameRange,
  frameRangeDuration,
  masterFrame,
  type FrameRange,
  type MasterFrame,
} from "./range.js";
import { createTimelineSourceTransform, mapFrameExact } from "./transform.js";

export const professionalStateMetadataKey = "chai-studio.professional-state.v1";

export type ProfessionalAudioBehavior = "mute" | "resample" | "preserve-pitch";

export interface TimeRemapPoint {
  readonly id: StableEntityId;
  readonly timelineFrame: MasterFrame;
  readonly sourceFrame: MasterFrame;
  readonly interpolation: "hold" | "linear";
}

export interface TimeRemapDefinition {
  readonly clipId: StableEntityId;
  readonly monotonicPolicy: "forward-only" | "allow-reverse";
  readonly audioBehavior: ProfessionalAudioBehavior;
  readonly points: readonly TimeRemapPoint[];
}

export interface ProfessionalTake {
  readonly id: StableEntityId;
  readonly label: string;
  readonly assetId: StableEntityId | null;
  readonly nestedSequenceId: StableEntityId | null;
  readonly reviewRevisionId: StableEntityId;
}

export interface ProfessionalTakeStack {
  readonly id: StableEntityId;
  readonly clipId: StableEntityId;
  readonly activeTakeId: StableEntityId;
  readonly takes: readonly ProfessionalTake[];
}

export interface ProfessionalEffect {
  readonly id: StableEntityId;
  readonly name: string;
  readonly ownership: "common" | "engine-native";
  readonly engine: TimelineEngine | null;
  readonly capability: "native" | "unified" | "bake_required" | "fallback_available";
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
  readonly fallback: "bake" | "shared" | null;
}

export interface AdjustmentLayerDefinition {
  readonly id: StableEntityId;
  readonly clipId: StableEntityId;
  readonly range: FrameRange;
  readonly effects: readonly ProfessionalEffect[];
}

export interface AdvancedBridgeDefinition {
  readonly id: StableEntityId;
  readonly fromClipId: StableEntityId;
  readonly toClipId: StableEntityId;
  readonly range: FrameRange;
  readonly implementation: "shared" | "shader" | "custom";
  readonly owner: TimelineEngine | "shared";
  readonly outgoingHandleFrames: MasterFrame;
  readonly incomingHandleFrames: MasterFrame;
  readonly preRollFrames: MasterFrame;
  readonly postRollFrames: MasterFrame;
  readonly alpha: "opaque" | "straight" | "premultiplied";
  readonly audioEnvelope: "none" | "linear" | "equal-power";
  readonly experimental: boolean;
  readonly fallback: "crossfade" | "bake" | null;
  readonly boundaryQa: "pending" | "passed" | "failed";
}

export interface CompoundDefinition {
  readonly id: StableEntityId;
  readonly compoundClipId: StableEntityId;
  readonly nestedSequence: NestedSequenceSnapshot;
  readonly sourceTrackId: StableEntityId;
  readonly childClips: readonly ClipSnapshot[];
  readonly childKeyframes: readonly KeyframeSnapshot[];
  readonly childAutomation: readonly AutomationLaneSnapshot[];
  readonly childTransitions: readonly TransitionSnapshot[];
  readonly childBridges: readonly BridgeSnapshot[];
  readonly dependencyIds: readonly StableEntityId[];
}

export interface ProfessionalTimelineState {
  readonly schemaVersion: "1.0.0";
  readonly compounds: Readonly<Record<StableEntityId, CompoundDefinition>>;
  readonly takeStacks: Readonly<Record<StableEntityId, ProfessionalTakeStack>>;
  readonly timeRemaps: Readonly<Record<StableEntityId, TimeRemapDefinition>>;
  readonly adjustmentLayers: Readonly<Record<StableEntityId, AdjustmentLayerDefinition>>;
  readonly advancedBridges: Readonly<Record<StableEntityId, AdvancedBridgeDefinition>>;
}

export type ProfessionalTimelineCommand =
  | Readonly<{
      kind: "clips.roll";
      leftClipId: StableEntityId;
      rightClipId: StableEntityId;
      boundary: MasterFrame;
      includeLinked: boolean;
    }>
  | Readonly<{
      kind: "clip.slip";
      clipId: StableEntityId;
      deltaTimelineFrames: MasterFrame;
      includeLinked: boolean;
    }>
  | Readonly<{
      kind: "clip.slide";
      clipId: StableEntityId;
      start: MasterFrame;
      includeLinked: boolean;
    }>
  | Readonly<{
      kind: "compound.create";
      compound: CompoundDefinition;
      compoundClip: ClipSnapshot;
    }>
  | Readonly<{ kind: "compound.flatten"; compoundId: StableEntityId }>
  | Readonly<{ kind: "takes.set"; stack: ProfessionalTakeStack }>
  | Readonly<{ kind: "take.activate"; stackId: StableEntityId; takeId: StableEntityId }>
  | Readonly<{
      kind: "clip.playback";
      clipId: StableEntityId;
      mode: "forward" | "reverse" | "freeze";
      freezeSourceFrame: MasterFrame | null;
      audioBehavior: ProfessionalAudioBehavior;
    }>
  | Readonly<{
      kind: "clip.speed";
      clipId: StableEntityId;
      speed: NormalizedRational;
      reconcile: "preserve-timeline-duration" | "preserve-source-range";
      audioBehavior: ProfessionalAudioBehavior;
    }>
  | Readonly<{ kind: "clip.time-remap"; definition: TimeRemapDefinition }>
  | Readonly<{ kind: "adjustment.upsert"; layer: AdjustmentLayerDefinition }>
  | Readonly<{ kind: "adjustment.remove"; layerId: StableEntityId }>
  | Readonly<{ kind: "bridge.advanced.upsert"; bridge: AdvancedBridgeDefinition }>
  | Readonly<{ kind: "bridge.advanced.remove"; bridgeId: StableEntityId }>;

export interface ProfessionalMutation {
  readonly snapshot: TimelineSnapshotV1;
  readonly label: string;
  readonly diffSummary: string;
  readonly affectedEntityIds: readonly StableEntityId[];
  readonly affectedRange: FrameRange | null;
}

export interface BridgeBoundarySample {
  readonly frame: MasterFrame;
  readonly outgoingPresent: boolean;
  readonly incomingPresent: boolean;
  readonly alphaValid: boolean;
}

export interface BridgeBoundaryQaReport {
  readonly passed: boolean;
  readonly missingFrames: readonly MasterFrame[];
  readonly duplicateFrames: readonly MasterFrame[];
  readonly invalidAlphaFrames: readonly MasterFrame[];
}

export const emptyProfessionalTimelineState = (): ProfessionalTimelineState => ({
  schemaVersion: "1.0.0",
  compounds: {},
  takeStacks: {},
  timeRemaps: {},
  adjustmentLayers: {},
  advancedBridges: {},
});

export const readProfessionalTimelineState = (timeline: TimelineSnapshotV1): ProfessionalTimelineState => {
  const encoded = timeline.professionalMetadata?.[professionalStateMetadataKey];
  if (encoded === undefined) return emptyProfessionalTimelineState();
  let decoded: unknown;
  try {
    decoded = decodeCanonical(JSON.parse(encoded) as unknown);
  } catch (error) {
    throw professionalError(
      "timeline.professional-state.invalid",
      "Professional timeline state is not valid canonical JSON.",
      error,
    );
  }
  if (!isRecord(decoded) || decoded.schemaVersion !== "1.0.0") {
    throw professionalError(
      "timeline.professional-state.version",
      "Professional timeline state has an unsupported schema version.",
    );
  }
  return decoded as unknown as ProfessionalTimelineState;
};

export const writeProfessionalTimelineState = (
  timeline: TimelineSnapshotV1,
  state: ProfessionalTimelineState,
): TimelineSnapshotV1 => ({
  ...timeline,
  professionalMetadata: {
    ...(timeline.professionalMetadata ?? {}),
    [professionalStateMetadataKey]: JSON.stringify(encodeCanonical(state)),
  },
});

export const applyProfessionalTimelineCommand = (
  timeline: TimelineSnapshotV1,
  command: ProfessionalTimelineCommand,
): ProfessionalMutation => {
  switch (command.kind) {
    case "clips.roll":
      return rollEdit(timeline, command);
    case "clip.slip":
      return slipEdit(timeline, command);
    case "clip.slide":
      return slideEdit(timeline, command);
    case "compound.create":
      return createCompound(timeline, command);
    case "compound.flatten":
      return flattenCompound(timeline, command.compoundId);
    case "takes.set":
      return setTakeStack(timeline, command.stack);
    case "take.activate":
      return activateTake(timeline, command.stackId, command.takeId);
    case "clip.playback":
      return setPlayback(timeline, command);
    case "clip.speed":
      return setConstantSpeed(timeline, command);
    case "clip.time-remap":
      return setTimeRemap(timeline, command.definition);
    case "adjustment.upsert":
      return upsertAdjustment(timeline, command.layer);
    case "adjustment.remove":
      return removeAdjustment(timeline, command.layerId);
    case "bridge.advanced.upsert":
      return upsertAdvancedBridge(timeline, command.bridge);
    case "bridge.advanced.remove":
      return removeAdvancedBridge(timeline, command.bridgeId);
  }
};

export const evaluateTimeRemap = (definition: TimeRemapDefinition, frame: MasterFrame): MasterFrame => {
  const points = orderedRemapPoints(definition);
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    throw professionalError("timeline.time-remap.empty", "Time remap requires at least two points.");
  }
  if (frame <= first.timelineFrame) return first.sourceFrame;
  if (frame >= last.timelineFrame) return last.sourceFrame;
  const rightIndex = points.findIndex((point) => point.timelineFrame > frame);
  const right = points[rightIndex];
  const left = points[rightIndex - 1];
  if (left === undefined || right === undefined) {
    throw professionalError("timeline.time-remap.segment", "Time remap segment lookup failed.");
  }
  if (left.interpolation === "hold") return left.sourceFrame;
  const timelineSpan = right.timelineFrame - left.timelineFrame;
  const offset = frame - left.timelineFrame;
  const sourceDelta = right.sourceFrame - left.sourceFrame;
  return masterFrame(left.sourceFrame + divideFloor(sourceDelta * offset, timelineSpan), true);
};

/** Both preview and render call this exact authority; the label is evidence, not a second evaluator. */
export const evaluateTimeRemapForPreview = evaluateTimeRemap;
export const evaluateTimeRemapForRender = evaluateTimeRemap;

export const validateBridgeBoundarySamples = (
  bridge: AdvancedBridgeDefinition,
  samples: readonly BridgeBoundarySample[],
): BridgeBoundaryQaReport => {
  const expected: MasterFrame[] = [];
  for (let frame = bridge.range.start; frame < bridge.range.end; frame = masterFrame(frame + 1n)) {
    expected.push(frame);
  }
  const counts = new Map<MasterFrame, number>();
  for (const sample of samples) counts.set(sample.frame, (counts.get(sample.frame) ?? 0) + 1);
  const missingFrames = expected.filter((frame) => !counts.has(frame));
  const duplicateFrames = [...counts.entries()].filter(([, count]) => count > 1).map(([frame]) => frame);
  const invalidAlphaFrames = samples.filter((sample) => !sample.alphaValid).map((sample) => sample.frame);
  const coverageInvalid = samples.some((sample) => !sample.outgoingPresent && !sample.incomingPresent);
  return {
    passed:
      missingFrames.length === 0 &&
      duplicateFrames.length === 0 &&
      invalidAlphaFrames.length === 0 &&
      !coverageInvalid,
    missingFrames,
    duplicateFrames,
    invalidAlphaFrames,
  };
};

export const affectedProfessionalCacheRanges = (
  state: ProfessionalTimelineState,
  entityIds: readonly StableEntityId[],
): readonly FrameRange[] => {
  const ids = new Set(entityIds);
  return [
    ...Object.values(state.adjustmentLayers)
      .filter(
        (layer) =>
          ids.has(layer.id) || ids.has(layer.clipId) || layer.effects.some((effect) => ids.has(effect.id)),
      )
      .map((layer) => layer.range),
    ...Object.values(state.advancedBridges)
      .filter((bridge) => ids.has(bridge.id) || ids.has(bridge.fromClipId) || ids.has(bridge.toClipId))
      .map((bridge) => bridge.range),
  ].sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));
};

const rollEdit = (
  timeline: TimelineSnapshotV1,
  command: Extract<ProfessionalTimelineCommand, { kind: "clips.roll" }>,
): ProfessionalMutation => {
  const pairs = linkedRollPairs(timeline, command.leftClipId, command.rightClipId, command.includeLinked);
  const clips = { ...timeline.clips };
  const affected: StableEntityId[] = [];
  for (const [leftId, rightId] of pairs) {
    const left = requireClip(timeline, leftId);
    const right = requireClip(timeline, rightId);
    if (left.trackId !== right.trackId || left.range.end !== right.range.start) {
      throw professionalError(
        "timeline.roll.not-adjacent",
        "Roll edit requires adjacent clips on one track.",
      );
    }
    if (command.boundary <= left.range.start || command.boundary >= right.range.end) {
      throw professionalError("timeline.roll.range", "Roll boundary must keep both adjacent clips positive.");
    }
    const leftSourceEnd = mapTimelineFrameToSource(timeline, left, command.boundary, "ceil");
    const rightSourceStart = mapTimelineFrameToSource(timeline, right, command.boundary, "floor");
    assertSourceBoundary(left, left.sourceRange.start, leftSourceEnd);
    assertSourceBoundary(right, rightSourceStart, right.sourceRange.end);
    clips[left.id] = {
      ...left,
      range: createFrameRange(left.range.start, command.boundary),
      sourceRange: createFrameRange(left.sourceRange.start, leftSourceEnd),
    };
    clips[right.id] = {
      ...right,
      range: createFrameRange(command.boundary, right.range.end),
      sourceRange: createFrameRange(rightSourceStart, right.sourceRange.end),
    };
    affected.push(left.id, right.id);
  }
  const snapshot = finalizeTimeline({ ...timeline, clips });
  assertOwnedKeyframesInside(snapshot, affected);
  return mutation(
    snapshot,
    "Roll edit",
    "Moved adjacent boundaries without changing sequence duration.",
    affected,
    {
      start: command.boundary,
      end: masterFrame(command.boundary + 1n),
    },
  );
};

const slipEdit = (
  timeline: TimelineSnapshotV1,
  command: Extract<ProfessionalTimelineCommand, { kind: "clip.slip" }>,
): ProfessionalMutation => {
  const ids = linkedClipIds(timeline, command.clipId, command.includeLinked);
  const clips = { ...timeline.clips };
  for (const id of ids) {
    const clip = requireClip(timeline, id);
    const sourceAtDelta = mapTimelineFrameToSource(
      timeline,
      { ...clip, range: createFrameRange(masterFrame(0n), frameRangeDuration(clip.range)) },
      command.deltaTimelineFrames,
      "nearest",
    );
    const sourceDelta = sourceAtDelta - clip.sourceRange.start;
    const start = masterFrame(clip.sourceRange.start + sourceDelta);
    const end = masterFrame(clip.sourceRange.end + sourceDelta);
    assertSourceBoundary(clip, start, end);
    clips[id] = { ...clip, sourceRange: createFrameRange(start, end) };
  }
  return mutation(
    { ...timeline, clips },
    "Slip edit",
    "Changed source handles with every timeline range fixed.",
    ids,
    rangeCover(ids.map((id) => requireClip(timeline, id).range)),
  );
};

const slideEdit = (
  timeline: TimelineSnapshotV1,
  command: Extract<ProfessionalTimelineCommand, { kind: "clip.slide" }>,
): ProfessionalMutation => {
  const movingIds = linkedClipIds(timeline, command.clipId, command.includeLinked);
  const primary = requireClip(timeline, command.clipId);
  const delta = command.start - primary.range.start;
  const clips = { ...timeline.clips };
  let keyframes = { ...timeline.keyframes };
  const affected: StableEntityId[] = [];
  for (const id of movingIds) {
    const selected = requireClip(timeline, id);
    const { left, right } = adjacentNeighbors(timeline, selected);
    const start = masterFrame(selected.range.start + delta);
    const end = masterFrame(selected.range.end + delta);
    if (start <= left.range.start || end >= right.range.end) {
      throw professionalError("timeline.slide.handles", "Slide edit exceeds an adjacent clip handle.");
    }
    const leftSourceEnd = mapTimelineFrameToSource(timeline, left, start, "ceil");
    const rightSourceStart = mapTimelineFrameToSource(timeline, right, end, "floor");
    assertSourceBoundary(left, left.sourceRange.start, leftSourceEnd);
    assertSourceBoundary(right, rightSourceStart, right.sourceRange.end);
    clips[left.id] = {
      ...left,
      range: createFrameRange(left.range.start, start),
      sourceRange: createFrameRange(left.sourceRange.start, leftSourceEnd),
    };
    clips[selected.id] = { ...selected, range: createFrameRange(start, end) };
    clips[right.id] = {
      ...right,
      range: createFrameRange(end, right.range.end),
      sourceRange: createFrameRange(rightSourceStart, right.sourceRange.end),
    };
    keyframes = shiftKeyframes(keyframes, selected.id, delta);
    affected.push(left.id, selected.id, right.id);
  }
  const snapshot = finalizeTimeline({ ...timeline, clips, keyframes });
  return mutation(
    snapshot,
    "Slide edit",
    "Moved selected content while preserving its duration and source range.",
    affected,
    rangeCover(affected.map((id) => requireClip(snapshot, id).range)),
  );
};

const createCompound = (
  timeline: TimelineSnapshotV1,
  command: Extract<ProfessionalTimelineCommand, { kind: "compound.create" }>,
): ProfessionalMutation => {
  const state = readProfessionalTimelineState(timeline);
  if (
    state.compounds[command.compound.id] !== undefined ||
    timeline.clips[command.compoundClip.id] !== undefined
  ) {
    throw professionalError("timeline.compound.id-exists", "Compound or compound clip ID already exists.");
  }
  const children = command.compound.childClips.map((child) => requireClip(timeline, child.id));
  if (children.length === 0 || children.some((child) => child.trackId !== command.compound.sourceTrackId)) {
    throw professionalError(
      "timeline.compound.children",
      "Compound creation requires source clips on one track.",
    );
  }
  const ordered = [...children].sort(compareClipRange);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1]?.range.end !== ordered[index]?.range.start) {
      throw professionalError("timeline.compound.gap", "Compound source clips must be contiguous.");
    }
  }
  const range = createFrameRange(
    ordered[0]?.range.start ?? masterFrame(0n),
    ordered.at(-1)?.range.end ?? masterFrame(0n),
  );
  if (
    command.compoundClip.trackId !== command.compound.sourceTrackId ||
    !sameRange(command.compoundClip.range, range)
  ) {
    throw professionalError("timeline.compound.range", "Compound clip must exactly replace its child range.");
  }
  if (command.compound.nestedSequence.duration !== frameRangeDuration(range)) {
    throw professionalError(
      "timeline.compound.duration",
      "Nested duration must equal the compound range duration.",
    );
  }
  const removing = new Set(children.map((child) => child.id));
  const removedKeyIds = new Set(command.compound.childKeyframes.map((keyframe) => keyframe.id));
  const removedLaneIds = new Set(command.compound.childAutomation.map((lane) => lane.id));
  const clips = Object.fromEntries(
    Object.values(timeline.clips)
      .filter((clip) => !removing.has(clip.id))
      .map((clip) => [clip.id, clip]),
  ) as Record<StableEntityId, ClipSnapshot>;
  clips[command.compoundClip.id] = {
    ...command.compoundClip,
    assetId: null,
    nestedSequenceId: command.compound.nestedSequence.id,
    sourceRate: command.compound.nestedSequence.rate,
  };
  const keyframes = Object.fromEntries(
    Object.values(timeline.keyframes)
      .filter((keyframe) => !removedKeyIds.has(keyframe.id))
      .map((keyframe) => [keyframe.id, keyframe]),
  ) as Record<StableEntityId, KeyframeSnapshot>;
  const automation = Object.fromEntries(
    Object.values(timeline.automation)
      .filter((lane) => !removedLaneIds.has(lane.id))
      .map((lane) => [lane.id, lane]),
  ) as Record<StableEntityId, AutomationLaneSnapshot>;
  const nextState: ProfessionalTimelineState = {
    ...state,
    compounds: { ...state.compounds, [command.compound.id]: command.compound },
  };
  const snapshot = writeProfessionalTimelineState(
    finalizeTimeline({
      ...timeline,
      clips,
      keyframes,
      automation,
      nestedSequences: {
        ...timeline.nestedSequences,
        [command.compound.nestedSequence.id]: command.compound.nestedSequence,
      },
      selection: {
        primaryId: command.compoundClip.id,
        selectedIds: [command.compoundClip.id],
        anchorId: command.compoundClip.id,
      },
    }),
    nextState,
  );
  return mutation(
    snapshot,
    "Create compound clip",
    "Nested contiguous clips with exact rational timing.",
    [command.compound.id, command.compoundClip.id, ...removing],
    range,
  );
};

const flattenCompound = (timeline: TimelineSnapshotV1, compoundId: StableEntityId): ProfessionalMutation => {
  const state = readProfessionalTimelineState(timeline);
  const compound = state.compounds[compoundId];
  if (compound === undefined)
    throw professionalError("timeline.compound.missing", `Compound ${compoundId} does not exist.`);
  const compoundClip = requireClip(timeline, compound.compoundClipId);
  const clips = omitRecordEntry(timeline.clips, compoundClip.id);
  for (const child of compound.childClips) {
    if (clips[child.id] !== undefined)
      throw professionalError("timeline.compound.flatten-conflict", `Child ${child.id} already exists.`);
    clips[child.id] = child;
  }
  const keyframes = { ...timeline.keyframes };
  for (const keyframe of compound.childKeyframes) keyframes[keyframe.id] = keyframe;
  const automation = { ...timeline.automation };
  for (const lane of compound.childAutomation) automation[lane.id] = lane;
  const nestedSequences = omitRecordEntry(timeline.nestedSequences, compound.nestedSequence.id);
  const compounds = omitRecordEntry(state.compounds, compoundId);
  const snapshot = writeProfessionalTimelineState(
    finalizeTimeline({
      ...timeline,
      clips,
      keyframes,
      automation,
      nestedSequences,
      selection: {
        primaryId: compound.childClips[0]?.id ?? null,
        selectedIds: compound.childClips.map((clip) => clip.id),
        anchorId: compound.childClips[0]?.id ?? null,
      },
    }),
    { ...state, compounds },
  );
  return mutation(
    snapshot,
    "Flatten compound clip",
    "Restored nested children without changing their exact timing.",
    [compoundId, compoundClip.id, ...compound.childClips.map((clip) => clip.id)],
    compoundClip.range,
  );
};

const setTakeStack = (timeline: TimelineSnapshotV1, stack: ProfessionalTakeStack): ProfessionalMutation => {
  requireClip(timeline, stack.clipId);
  validateTakeStack(stack);
  const state = readProfessionalTimelineState(timeline);
  const snapshot = writeProfessionalTimelineState(timeline, {
    ...state,
    takeStacks: { ...state.takeStacks, [stack.id]: stack },
  });
  return mutation(
    snapshot,
    "Set alternate takes",
    "Referenced inactive takes without adding render dependencies.",
    [stack.id, stack.clipId, ...stack.takes.map((take) => take.id)],
    requireClip(timeline, stack.clipId).range,
  );
};

const activateTake = (
  timeline: TimelineSnapshotV1,
  stackId: StableEntityId,
  takeId: StableEntityId,
): ProfessionalMutation => {
  const state = readProfessionalTimelineState(timeline);
  const stack = state.takeStacks[stackId];
  if (stack === undefined)
    throw professionalError("timeline.take-stack.missing", `Take stack ${stackId} does not exist.`);
  const take = stack.takes.find((item) => item.id === takeId);
  if (take === undefined)
    throw professionalError("timeline.take.missing", `Take ${takeId} is not in stack ${stackId}.`);
  const clip = requireClip(timeline, stack.clipId);
  const clips = {
    ...timeline.clips,
    [clip.id]: {
      ...clip,
      assetId: take.assetId,
      nestedSequenceId: take.nestedSequenceId,
      metadata: { ...clip.metadata, activeTakeId: take.id, activeTakeRevisionId: take.reviewRevisionId },
    },
  };
  const nextStack = { ...stack, activeTakeId: take.id };
  const snapshot = writeProfessionalTimelineState(
    { ...timeline, clips },
    { ...state, takeStacks: { ...state.takeStacks, [stack.id]: nextStack } },
  );
  return mutation(
    snapshot,
    "Activate take",
    `Activated ${take.label}; inactive takes remain reference-only.`,
    [stack.id, clip.id, take.id],
    clip.range,
  );
};

const setPlayback = (
  timeline: TimelineSnapshotV1,
  command: Extract<ProfessionalTimelineCommand, { kind: "clip.playback" }>,
): ProfessionalMutation => {
  const clip = requireClip(timeline, command.clipId);
  if (command.mode === "freeze") {
    if (
      command.freezeSourceFrame === null ||
      command.freezeSourceFrame < clip.availableSourceRange.start ||
      command.freezeSourceFrame >= clip.availableSourceRange.end
    ) {
      throw professionalError(
        "timeline.freeze.source-frame",
        "Freeze frame must sample one available source frame.",
      );
    }
  } else if (command.freezeSourceFrame !== null) {
    throw professionalError(
      "timeline.playback.freeze-frame-unexpected",
      "Only freeze playback accepts a freeze source frame.",
    );
  }
  const clips = {
    ...timeline.clips,
    [clip.id]: {
      ...clip,
      metadata: {
        ...clip.metadata,
        playbackMode: command.mode,
        freezeSourceFrame: command.freezeSourceFrame === null ? "" : String(command.freezeSourceFrame),
        playbackAudioBehavior: command.audioBehavior,
      },
    },
  };
  return mutation(
    { ...timeline, clips },
    command.mode === "freeze"
      ? "Freeze frame"
      : command.mode === "reverse"
        ? "Reverse clip"
        : "Restore forward playback",
    `Applied exact ${command.mode} sampling with ${command.audioBehavior} audio.`,
    [clip.id],
    clip.range,
  );
};

const setConstantSpeed = (
  timeline: TimelineSnapshotV1,
  command: Extract<ProfessionalTimelineCommand, { kind: "clip.speed" }>,
): ProfessionalMutation => {
  const clip = requireClip(timeline, command.clipId);
  const speed = deserializeRational(command.speed);
  if (parseBigIntString(speed.numerator) <= 0n)
    throw professionalError(
      "timeline.speed.non-positive",
      "Constant speed must be a positive normalized rational.",
    );
  let range = clip.range;
  let sourceRange = clip.sourceRange;
  if (command.reconcile === "preserve-timeline-duration") {
    const transform = createTimelineSourceTransform({
      timelineOrigin: clip.range.start,
      sourceOrigin: clip.sourceRange.start,
      timelineRate: timeline.fps,
      sourceRate: clip.sourceRate,
      speed,
    });
    sourceRange = createFrameRange(clip.sourceRange.start, mapFrameExact(transform, clip.range.end, "ceil"));
    assertSourceBoundary(clip, sourceRange.start, sourceRange.end);
  } else {
    const sourceDuration = frameRangeDuration(clip.sourceRange);
    const timelineRate = rationalParts(timeline.fps);
    const sourceRate = rationalParts(clip.sourceRate);
    const speedParts = rationalParts(speed);
    const numerator =
      sourceDuration * sourceRate.denominator * timelineRate.numerator * speedParts.denominator;
    const denominator = sourceRate.numerator * timelineRate.denominator * speedParts.numerator;
    const duration = masterFrame(divideCeil(numerator, denominator));
    range = createFrameRange(clip.range.start, masterFrame(clip.range.start + duration));
  }
  const clips = {
    ...timeline.clips,
    [clip.id]: {
      ...clip,
      range,
      sourceRange,
      speed,
      metadata: { ...clip.metadata, speedAudioBehavior: command.audioBehavior },
    },
  };
  const snapshot = finalizeTimeline({ ...timeline, clips });
  assertOwnedKeyframesInside(snapshot, [clip.id]);
  return mutation(
    snapshot,
    "Change clip speed",
    `Persisted normalized rational speed ${speed.numerator}/${speed.denominator}.`,
    [clip.id],
    rangeCover([clip.range, range]),
  );
};

const setTimeRemap = (
  timeline: TimelineSnapshotV1,
  definition: TimeRemapDefinition,
): ProfessionalMutation => {
  const clip = requireClip(timeline, definition.clipId);
  const points = orderedRemapPoints(definition);
  if (
    points.length < 2 ||
    points[0]?.timelineFrame !== clip.range.start ||
    points.at(-1)?.timelineFrame !== clip.range.end
  ) {
    throw professionalError(
      "timeline.time-remap.boundaries",
      "Time remap must define exact clip start and exclusive end points.",
    );
  }
  for (const point of points) {
    if (
      point.sourceFrame < clip.availableSourceRange.start ||
      point.sourceFrame > clip.availableSourceRange.end
    ) {
      throw professionalError(
        "timeline.time-remap.source-handle",
        "Time remap point exceeds available source handles.",
      );
    }
  }
  if (definition.monotonicPolicy === "forward-only") {
    for (let index = 1; index < points.length; index += 1) {
      if ((points[index]?.sourceFrame ?? 0n) < (points[index - 1]?.sourceFrame ?? 0n)) {
        throw professionalError(
          "timeline.time-remap.non-monotonic",
          "Forward-only remap cannot move backwards in source time.",
        );
      }
    }
  }
  const state = readProfessionalTimelineState(timeline);
  const snapshot = writeProfessionalTimelineState(timeline, {
    ...state,
    timeRemaps: { ...state.timeRemaps, [clip.id]: { ...definition, points } },
  });
  return mutation(
    snapshot,
    "Set time remap",
    "Stored one deterministic mapping shared by preview and render.",
    [clip.id, ...points.map((point) => point.id)],
    clip.range,
  );
};

const upsertAdjustment = (
  timeline: TimelineSnapshotV1,
  layer: AdjustmentLayerDefinition,
): ProfessionalMutation => {
  const clip = requireClip(timeline, layer.clipId);
  if (layer.range.start < clip.range.start || layer.range.end > clip.range.end)
    throw professionalError(
      "timeline.adjustment.range",
      "Adjustment range must remain inside its owner clip.",
    );
  for (const effect of layer.effects) {
    if (effect.ownership === "engine-native" && effect.engine !== clip.engine && effect.fallback === null) {
      throw professionalError(
        "timeline.adjustment.cross-engine-fallback",
        `Effect ${effect.id} requires an explicit bake or shared fallback.`,
      );
    }
    if (effect.capability === "bake_required" && effect.fallback !== "bake") {
      throw professionalError(
        "timeline.adjustment.bake-required",
        `Effect ${effect.id} requires an explicit bake fallback.`,
      );
    }
  }
  const state = readProfessionalTimelineState(timeline);
  const snapshot = writeProfessionalTimelineState(timeline, {
    ...state,
    adjustmentLayers: { ...state.adjustmentLayers, [layer.id]: layer },
  });
  return mutation(
    snapshot,
    "Update adjustment layer",
    "Limited effect ownership and invalidation to one exact range.",
    [layer.id, layer.clipId, ...layer.effects.map((effect) => effect.id)],
    layer.range,
  );
};

const removeAdjustment = (timeline: TimelineSnapshotV1, layerId: StableEntityId): ProfessionalMutation => {
  const state = readProfessionalTimelineState(timeline);
  const layer = state.adjustmentLayers[layerId];
  if (layer === undefined)
    throw professionalError("timeline.adjustment.missing", `Adjustment layer ${layerId} does not exist.`);
  const adjustmentLayers = omitRecordEntry(state.adjustmentLayers, layerId);
  return mutation(
    writeProfessionalTimelineState(timeline, { ...state, adjustmentLayers }),
    "Remove adjustment layer",
    "Removed only the selected range effect and its cache dependency.",
    [layer.id, layer.clipId],
    layer.range,
  );
};

const upsertAdvancedBridge = (
  timeline: TimelineSnapshotV1,
  bridge: AdvancedBridgeDefinition,
): ProfessionalMutation => {
  const from = requireClip(timeline, bridge.fromClipId);
  const to = requireClip(timeline, bridge.toClipId);
  if (bridge.range.start < from.range.start || bridge.range.end > to.range.end)
    throw professionalError("timeline.bridge.range", "Bridge range exceeds participating clip coverage.");
  if (bridge.experimental && (bridge.fallback === null || bridge.boundaryQa !== "passed")) {
    throw professionalError(
      "timeline.bridge.experimental-blocked",
      "Experimental bridges require a fallback and passed boundary QA before persistence.",
    );
  }
  if (
    bridge.owner !== "shared" &&
    bridge.owner !== from.engine &&
    bridge.owner !== to.engine &&
    bridge.fallback === null
  ) {
    throw professionalError(
      "timeline.bridge.owner",
      "Cross-engine bridge ownership requires an explicit fallback.",
    );
  }
  const state = readProfessionalTimelineState(timeline);
  const snapshot = writeProfessionalTimelineState(timeline, {
    ...state,
    advancedBridges: { ...state.advancedBridges, [bridge.id]: bridge },
  });
  return mutation(
    snapshot,
    "Update advanced bridge",
    "Stored handles, alpha, roll, audio envelope, fallback, and boundary QA as one exact-range bridge.",
    [bridge.id, bridge.fromClipId, bridge.toClipId],
    bridge.range,
  );
};

const removeAdvancedBridge = (
  timeline: TimelineSnapshotV1,
  bridgeId: StableEntityId,
): ProfessionalMutation => {
  const state = readProfessionalTimelineState(timeline);
  const bridge = state.advancedBridges[bridgeId];
  if (bridge === undefined)
    throw professionalError("timeline.bridge.missing", `Bridge ${bridgeId} does not exist.`);
  const advancedBridges = omitRecordEntry(state.advancedBridges, bridgeId);
  return mutation(
    writeProfessionalTimelineState(timeline, { ...state, advancedBridges }),
    "Remove advanced bridge",
    "Removed the selected bridge without altering source clips.",
    [bridge.id, bridge.fromClipId, bridge.toClipId],
    bridge.range,
  );
};

const mutation = (
  snapshot: TimelineSnapshotV1,
  label: string,
  diffSummary: string,
  affectedEntityIds: readonly StableEntityId[],
  affectedRange: FrameRange | null,
): ProfessionalMutation => ({
  snapshot,
  label,
  diffSummary,
  affectedEntityIds: [...new Set(affectedEntityIds)],
  affectedRange,
});

const requireClip = (timeline: TimelineSnapshotV1, id: StableEntityId): ClipSnapshot => {
  const clip = timeline.clips[id];
  if (clip === undefined)
    throw professionalError("timeline.clip.missing", `Timeline clip ${id} does not exist.`);
  const track = timeline.tracks[clip.trackId];
  if (track?.locked === true)
    throw professionalError("timeline.track.locked", `Track ${track.id} is locked.`);
  return clip;
};

const linkedClipIds = (
  timeline: TimelineSnapshotV1,
  clipId: StableEntityId,
  includeLinked: boolean,
): readonly StableEntityId[] => {
  const clip = requireClip(timeline, clipId);
  if (!includeLinked || clip.linkGroupId === null) return [clip.id];
  return Object.values(timeline.clips)
    .filter((item) => item.linkGroupId === clip.linkGroupId)
    .map((item) => item.id)
    .sort();
};

const linkedRollPairs = (
  timeline: TimelineSnapshotV1,
  leftId: StableEntityId,
  rightId: StableEntityId,
  includeLinked: boolean,
): readonly (readonly [StableEntityId, StableEntityId])[] => {
  const left = requireClip(timeline, leftId);
  const right = requireClip(timeline, rightId);
  if (!includeLinked || left.linkGroupId === null || right.linkGroupId === null) return [[left.id, right.id]];
  const leftLinked = linkedClipIds(timeline, left.id, true);
  const rightLinked = linkedClipIds(timeline, right.id, true);
  const pairs: (readonly [StableEntityId, StableEntityId])[] = [];
  for (const linkedLeftId of leftLinked) {
    const linkedLeft = requireClip(timeline, linkedLeftId);
    const linkedRight = rightLinked
      .map((id) => requireClip(timeline, id))
      .find(
        (candidate) =>
          candidate.trackId === linkedLeft.trackId && candidate.range.start === linkedLeft.range.end,
      );
    if (linkedRight !== undefined) pairs.push([linkedLeft.id, linkedRight.id]);
  }
  if (pairs.length === 0)
    throw professionalError("timeline.roll.linked-coverage", "Linked roll has no complete adjacent pair.");
  return pairs;
};

const adjacentNeighbors = (
  timeline: TimelineSnapshotV1,
  selected: ClipSnapshot,
): Readonly<{ left: ClipSnapshot; right: ClipSnapshot }> => {
  const track = timeline.tracks[selected.trackId];
  if (track === undefined)
    throw professionalError("timeline.track.missing", `Track ${selected.trackId} does not exist.`);
  const ordered = track.clipIds.map((id) => requireClip(timeline, id)).sort(compareClipRange);
  const index = ordered.findIndex((clip) => clip.id === selected.id);
  const left = ordered[index - 1];
  const right = ordered[index + 1];
  if (
    left === undefined ||
    right === undefined ||
    left.range.end !== selected.range.start ||
    selected.range.end !== right.range.start
  ) {
    throw professionalError(
      "timeline.slide.neighbors",
      "Slide edit requires contiguous clips on both sides.",
    );
  }
  return { left, right };
};

const mapTimelineFrameToSource = (
  timeline: TimelineSnapshotV1,
  clip: ClipSnapshot,
  frame: MasterFrame,
  policy: "floor" | "ceil" | "nearest",
): MasterFrame =>
  mapFrameExact(
    createTimelineSourceTransform({
      timelineOrigin: clip.range.start,
      sourceOrigin: clip.sourceRange.start,
      timelineRate: timeline.fps,
      sourceRate: clip.sourceRate,
      speed: clip.speed,
    }),
    frame,
    policy,
  );

const assertSourceBoundary = (clip: ClipSnapshot, start: MasterFrame, end: MasterFrame): void => {
  if (start < clip.availableSourceRange.start || end > clip.availableSourceRange.end || start >= end)
    throw professionalError("timeline.source.handles", `Clip ${clip.id} has insufficient source handles.`);
};

const assertOwnedKeyframesInside = (
  timeline: TimelineSnapshotV1,
  clipIds: readonly StableEntityId[],
): void => {
  const ids = new Set(clipIds);
  for (const keyframe of Object.values(timeline.keyframes)) {
    if (!ids.has(keyframe.ownerEntityId)) continue;
    const clip = timeline.clips[keyframe.ownerEntityId];
    if (clip !== undefined && (keyframe.frame < clip.range.start || keyframe.frame >= clip.range.end))
      throw professionalError(
        "timeline.keyframe.outside-owner",
        `Keyframe ${keyframe.id} would fall outside its edited clip.`,
      );
  }
};

const shiftKeyframes = (
  keyframes: Readonly<Record<StableEntityId, KeyframeSnapshot>>,
  ownerId: StableEntityId,
  delta: bigint,
): Record<StableEntityId, KeyframeSnapshot> =>
  Object.fromEntries(
    Object.values(keyframes).map((keyframe) => [
      keyframe.id,
      keyframe.ownerEntityId === ownerId
        ? { ...keyframe, frame: masterFrame(keyframe.frame + delta) }
        : keyframe,
    ]),
  );

const omitRecordEntry = <Value>(
  record: Readonly<Record<StableEntityId, Value>>,
  key: StableEntityId,
): Record<StableEntityId, Value> =>
  Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));

const finalizeTimeline = (timeline: TimelineSnapshotV1): TimelineSnapshotV1 => {
  const tracks = Object.fromEntries(
    Object.values(timeline.tracks).map((track) => [
      track.id,
      {
        ...track,
        clipIds: Object.values(timeline.clips)
          .filter((clip) => clip.trackId === track.id)
          .sort(compareClipRange)
          .map((clip) => clip.id),
      },
    ]),
  ) as TimelineSnapshotV1["tracks"];
  const duration = Object.values(timeline.clips).reduce(
    (maximum, clip) => (clip.range.end > maximum ? clip.range.end : maximum),
    masterFrame(0n),
  );
  return { ...timeline, tracks, duration };
};

const validateTakeStack = (stack: ProfessionalTakeStack): void => {
  if (stack.takes.length === 0 || !stack.takes.some((take) => take.id === stack.activeTakeId))
    throw professionalError("timeline.take-stack.active", "Take stack must contain its active take.");
  if (new Set(stack.takes.map((take) => take.id)).size !== stack.takes.length)
    throw professionalError("timeline.take-stack.duplicate", "Take IDs must be unique within a stack.");
  for (const take of stack.takes)
    if ((take.assetId === null) === (take.nestedSequenceId === null))
      throw professionalError(
        "timeline.take.source",
        `Take ${take.id} must reference exactly one asset or nested sequence.`,
      );
};

const orderedRemapPoints = (definition: TimeRemapDefinition): readonly TimeRemapPoint[] => {
  const points = [...definition.points].sort((left, right) =>
    left.timelineFrame < right.timelineFrame
      ? -1
      : left.timelineFrame > right.timelineFrame
        ? 1
        : left.id.localeCompare(right.id, "en"),
  );
  for (let index = 1; index < points.length; index += 1)
    if (points[index]?.timelineFrame === points[index - 1]?.timelineFrame)
      throw professionalError(
        "timeline.time-remap.duplicate-frame",
        "Time remap points require unique timeline frames.",
      );
  return points;
};

const rangeCover = (ranges: readonly FrameRange[]): FrameRange | null => {
  const first = ranges[0];
  if (first === undefined) return null;
  let start = first.start;
  let end = first.end;
  for (const range of ranges.slice(1)) {
    if (range.start < start) start = range.start;
    if (range.end > end) end = range.end;
  }
  return createFrameRange(start, end);
};

const compareClipRange = (left: ClipSnapshot, right: ClipSnapshot): number =>
  left.range.start < right.range.start
    ? -1
    : left.range.start > right.range.start
      ? 1
      : left.id.localeCompare(right.id, "en");
const sameRange = (left: FrameRange, right: FrameRange): boolean =>
  left.start === right.start && left.end === right.end;
const rationalParts = (value: NormalizedRational): Readonly<{ numerator: bigint; denominator: bigint }> => {
  const normalized = deserializeRational(value);
  return {
    numerator: parseBigIntString(normalized.numerator),
    denominator: parseBigIntString(normalized.denominator),
  };
};
const divideCeil = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n || numerator < 0n)
    throw professionalError(
      "timeline.rational.divide",
      "Professional frame division requires non-negative input and a positive denominator.",
    );
  return (numerator + denominator - 1n) / denominator;
};
const divideFloor = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n)
    throw professionalError(
      "timeline.rational.divide",
      "Professional frame division requires a positive denominator.",
    );
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder !== 0n && numerator < 0n ? quotient - 1n : quotient;
};

const encodeCanonical = (value: unknown): unknown => {
  if (typeof value === "bigint") return { $chaiMasterFrame: String(value) };
  if (Array.isArray(value)) return value.map(encodeCanonical);
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((key) => [key, encodeCanonical(value[key])]),
    );
  return value;
};

const decodeCanonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decodeCanonical);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (
    keys.length === 1 &&
    keys[0] === "$chaiMasterFrame" &&
    typeof value.$chaiMasterFrame === "string" &&
    /^-?(0|[1-9][0-9]*)$/.test(value.$chaiMasterFrame)
  )
    return masterFrame(BigInt(value.$chaiMasterFrame), true);
  return Object.fromEntries(keys.map((key) => [key, decodeCanonical(value[key])]));
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const professionalError = (code: string, message: string, cause?: unknown): ChaiError =>
  new ChaiError({
    category: "timeline",
    code,
    correlationId: createCorrelationId(),
    stage: "professional-edit",
    message,
    repairHint:
      "Keep exact frame ranges, normalized rational timing, valid source handles, explicit fallbacks, and reversible command ownership.",
    ...(cause === undefined ? {} : { cause }),
  });
