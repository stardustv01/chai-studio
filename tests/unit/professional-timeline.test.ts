import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  affectedProfessionalCacheRanges,
  buildProfessionalSourceEdit,
  createEmptyTimelineSnapshot,
  createFrameRange,
  evaluateTimeRemapForPreview,
  evaluateTimeRemapForRender,
  executeTimelineCommand,
  masterFrame,
  readProfessionalTimelineState,
  resolveThreePointEdit,
  stableEntityId,
  validateBridgeBoundarySamples,
  type AdvancedBridgeDefinition,
  type ClipSnapshot,
  type CompoundDefinition,
  type StableEntityId,
  type TimelineSnapshotV1,
  type TrackSnapshot,
} from "../../packages/timeline/src/index.js";

describe("P25 professional trim and source editing", () => {
  it("rolls an adjacent boundary with handle validation, duration invariance, and exact inverse", () => {
    const timeline = professionalTimeline();
    const beforeDuration = timeline.duration;
    const result = executeTimelineCommand(timeline, {
      kind: "clips.roll",
      leftClipId: id("clip-pro-left-0001"),
      rightClipId: id("clip-pro-middle-0001"),
      boundary: masterFrame(50n),
      includeLinked: false,
    });
    expect(result.snapshot.duration).toBe(beforeDuration);
    expect(result.snapshot.clips[id("clip-pro-left-0001")]?.range).toEqual({ start: 0n, end: 50n });
    expect(result.snapshot.clips[id("clip-pro-middle-0001")]?.sourceRange).toEqual({
      start: 210n,
      end: 240n,
    });
    expect(executeTimelineCommand(result.snapshot, result.inverse).snapshot).toEqual(timeline);
  });

  it("slips exact rational source handles while the timeline range remains fixed", () => {
    const timeline = professionalTimeline();
    const clipId = id("clip-pro-middle-0001");
    const priorRange = timeline.clips[clipId]?.range;
    const result = executeTimelineCommand(timeline, {
      kind: "clip.slip",
      clipId,
      deltaTimelineFrames: masterFrame(5n),
      includeLinked: false,
    });
    expect(result.snapshot.clips[clipId]?.range).toEqual(priorRange);
    expect(result.snapshot.clips[clipId]?.sourceRange).toEqual({ start: 205n, end: 245n });
    expect(executeTimelineCommand(result.snapshot, result.inverse).snapshot).toEqual(timeline);
  });

  it("slides a clip while its duration/source stay fixed and neighbor handles reconcile", () => {
    const timeline = professionalTimeline();
    const clipId = id("clip-pro-middle-0001");
    const priorSource = timeline.clips[clipId]?.sourceRange;
    const result = executeTimelineCommand(timeline, {
      kind: "clip.slide",
      clipId,
      start: masterFrame(50n),
      includeLinked: false,
    });
    expect(result.snapshot.clips[clipId]).toMatchObject({
      range: { start: 50n, end: 90n },
      sourceRange: priorSource,
    });
    expect(result.snapshot.clips[id("clip-pro-left-0001")]?.range.end).toBe(50n);
    expect(result.snapshot.clips[id("clip-pro-right-0001")]?.range.start).toBe(90n);
    expect(result.snapshot.duration).toBe(timeline.duration);
  });

  it("rolls and slides still-image clips without inventing source handles", () => {
    const timeline = staticProfessionalTimeline();
    const leftId = id("clip-pro-left-0001");
    const middleId = id("clip-pro-middle-0001");
    const rightId = id("clip-pro-right-0001");
    const rolled = executeTimelineCommand(timeline, {
      kind: "clips.roll",
      leftClipId: leftId,
      rightClipId: middleId,
      boundary: masterFrame(41n),
      includeLinked: false,
    });

    expect(rolled.snapshot.clips[leftId]?.range).toEqual({ start: 0n, end: 41n });
    expect(rolled.snapshot.clips[middleId]?.range).toEqual({ start: 41n, end: 80n });
    expect(rolled.snapshot.clips[leftId]?.sourceRange).toEqual({ start: 0n, end: 1n });
    expect(rolled.snapshot.clips[middleId]?.sourceRange).toEqual({ start: 0n, end: 1n });

    const slid = executeTimelineCommand(timeline, {
      kind: "clip.slide",
      clipId: middleId,
      start: masterFrame(41n),
      includeLinked: false,
    });
    expect(slid.snapshot.clips[middleId]?.range).toEqual({ start: 41n, end: 81n });
    expect(slid.snapshot.clips[leftId]?.range.end).toBe(41n);
    expect(slid.snapshot.clips[rightId]?.range.start).toBe(81n);
    expect(slid.snapshot.clips[leftId]?.sourceRange).toEqual({ start: 0n, end: 1n });
    expect(slid.snapshot.clips[rightId]?.sourceRange).toEqual({ start: 0n, end: 1n });
  });

  it("rejects speed, reverse, and freeze operations that are meaningless for a still image", () => {
    const base = professionalTimeline();
    const clipId = id("clip-pro-middle-0001");
    const selected = required(base.clips[clipId]);
    const timeline = {
      ...base,
      clips: {
        ...base.clips,
        [clipId]: { ...selected, metadata: { ...selected.metadata, assetKind: "image" } },
      },
    };

    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "clip.speed",
        clipId,
        speed: normalizeRational(2n, 1n),
        reconcile: "preserve-source-range",
        audioBehavior: "mute",
      }),
    ).toThrow("Still clips have no playback speed");
    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "clip.playback",
        clipId,
        mode: "reverse",
        freezeSourceFrame: null,
        audioBehavior: "mute",
      }),
    ).toThrow("already hold one source frame");
    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "clip.playback",
        clipId,
        mode: "freeze",
        freezeSourceFrame: masterFrame(0n),
        audioBehavior: "mute",
      }),
    ).toThrow("already hold one source frame");
  });

  it("resolves all three-point ranges and builds insert/overwrite/replace commands without moving either clock", () => {
    const timeline = professionalTimeline();
    const sourceClip = {
      ...required(timeline.clips[id("clip-pro-middle-0001")]),
      id: id("clip-pro-source-edit-0001"),
    };
    const resolved = resolveThreePointEdit(sourceClip, timeline.fps, {
      sourceIn: masterFrame(300n),
      sourceOut: masterFrame(340n),
      timelineIn: masterFrame(120n),
      timelineOut: null,
    });
    expect(resolved).toMatchObject({
      timelineRange: { start: 120n, end: 160n },
      sourceRange: { start: 300n, end: 340n },
      derivedPoint: "timeline-out",
    });
    const built = buildProfessionalSourceEdit(
      timeline,
      {
        sourceClip,
        targetTrackId: id("track-pro-video-0001"),
        editKind: "insert",
        replaceClipId: null,
        timelineRate: timeline.fps,
        marks: {
          sourceIn: masterFrame(300n),
          sourceOut: masterFrame(340n),
          timelineIn: masterFrame(120n),
          timelineOut: null,
        },
      },
      masterFrame(315n),
    );
    expect(built.command.kind).toBe("clip.insert");
    expect(built.sourceTransportFrame).toBe(315n);
    expect(built.timelineTransportUnchanged).toBe(true);
  });
});

describe("P25 nested, versions, playback, retiming, effects, and bridges", () => {
  it("creates and flattens a rational nested clip while preserving child dependencies", () => {
    const timeline = professionalTimeline();
    const left = required(timeline.clips[id("clip-pro-left-0001")]);
    const middle = required(timeline.clips[id("clip-pro-middle-0001")]);
    const compoundId = id("compound-pro-0001");
    const nestedId = id("nested-pro-0001");
    const compoundClip = clip("clip-pro-compound-0001", left.trackId, 0n, 80n, 0n);
    const compound: CompoundDefinition = {
      id: compoundId,
      compoundClipId: compoundClip.id,
      nestedSequence: {
        id: nestedId,
        timelineId: id("timeline-pro-nested-0001"),
        rate: normalizeRational(1n, 1n),
        duration: masterFrame(80n),
      },
      sourceTrackId: left.trackId,
      childClips: [left, middle],
      childKeyframes: [],
      childAutomation: [],
      childTransitions: [],
      childBridges: [],
      dependencyIds: [required(left.assetId), required(middle.assetId)],
    };
    const created = executeTimelineCommand(timeline, { kind: "compound.create", compound, compoundClip });
    expect(created.snapshot.clips[compoundClip.id]?.nestedSequenceId).toBe(nestedId);
    expect(readProfessionalTimelineState(created.snapshot).compounds[compoundId]?.dependencyIds).toHaveLength(
      2,
    );
    const flattened = executeTimelineCommand(created.snapshot, { kind: "compound.flatten", compoundId });
    expect(flattened.snapshot.clips[left.id]).toEqual(left);
    expect(flattened.snapshot.clips[middle.id]).toEqual(middle);
    expect(flattened.snapshot.clips[compoundClip.id]).toBeUndefined();
  });

  it("switches active takes while inactive versions stay reference-only", () => {
    const timeline = professionalTimeline();
    const clipId = id("clip-pro-middle-0001");
    const stackId = id("take-stack-pro-0001");
    const takeA = id("take-pro-0001");
    const takeB = id("take-pro-0002");
    const stacked = executeTimelineCommand(timeline, {
      kind: "takes.set",
      stack: {
        id: stackId,
        clipId,
        activeTakeId: takeA,
        takes: [
          {
            id: takeA,
            label: "Take A",
            assetId: id("asset-pro-take-0001"),
            nestedSequenceId: null,
            reviewRevisionId: id("revision-pro-take-0001"),
          },
          {
            id: takeB,
            label: "Take B",
            assetId: id("asset-pro-take-0002"),
            nestedSequenceId: null,
            reviewRevisionId: id("revision-pro-take-0002"),
          },
        ],
      },
    });
    const active = executeTimelineCommand(stacked.snapshot, {
      kind: "take.activate",
      stackId,
      takeId: takeB,
    });
    expect(active.snapshot.clips[clipId]?.assetId).toBe("asset-pro-take-0002");
    expect(readProfessionalTimelineState(active.snapshot).takeStacks[stackId]?.takes).toHaveLength(2);
  });

  it("applies freeze/reverse defaults and normalized rational constant speed", () => {
    const timeline = professionalTimeline();
    const clipId = id("clip-pro-middle-0001");
    const frozen = executeTimelineCommand(timeline, {
      kind: "clip.playback",
      clipId,
      mode: "freeze",
      freezeSourceFrame: masterFrame(215n),
      audioBehavior: "mute",
    });
    expect(frozen.snapshot.clips[clipId]?.metadata).toMatchObject({
      playbackMode: "freeze",
      freezeSourceFrame: "215",
      playbackAudioBehavior: "mute",
    });
    const sped = executeTimelineCommand(timeline, {
      kind: "clip.speed",
      clipId,
      speed: normalizeRational(2n, 2n),
      reconcile: "preserve-timeline-duration",
      audioBehavior: "preserve-pitch",
    });
    expect(sped.snapshot.clips[clipId]?.speed).toEqual(normalizeRational(1n, 1n));
  });

  it("uses one deterministic remap evaluator for preview and render and blocks forbidden reverse curves", () => {
    const timeline = professionalTimeline();
    const clipId = id("clip-pro-middle-0001");
    const definition = {
      clipId,
      monotonicPolicy: "forward-only" as const,
      audioBehavior: "resample" as const,
      points: [
        {
          id: id("remap-pro-point-0001"),
          timelineFrame: masterFrame(40n),
          sourceFrame: masterFrame(200n),
          interpolation: "linear" as const,
        },
        {
          id: id("remap-pro-point-0002"),
          timelineFrame: masterFrame(60n),
          sourceFrame: masterFrame(230n),
          interpolation: "linear" as const,
        },
        {
          id: id("remap-pro-point-0003"),
          timelineFrame: masterFrame(80n),
          sourceFrame: masterFrame(240n),
          interpolation: "linear" as const,
        },
      ],
    };
    const result = executeTimelineCommand(timeline, { kind: "clip.time-remap", definition });
    const persisted = required(readProfessionalTimelineState(result.snapshot).timeRemaps[clipId]);
    expect(evaluateTimeRemapForPreview(persisted, masterFrame(50n))).toBe(
      evaluateTimeRemapForRender(persisted, masterFrame(50n)),
    );
    expect(evaluateTimeRemapForRender(persisted, masterFrame(50n))).toBe(215n);
    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "clip.time-remap",
        definition: {
          ...definition,
          points: [
            required(definition.points[0]),
            { ...required(definition.points[2]), sourceFrame: masterFrame(190n) },
          ],
        },
      }),
    ).toThrow("Forward-only remap");
  });

  it("limits adjustment invalidation and enforces explicit cross-engine fallback", () => {
    const timeline = professionalTimeline();
    const layerId = id("adjustment-pro-0001");
    const clipId = id("clip-pro-middle-0001");
    const result = executeTimelineCommand(timeline, {
      kind: "adjustment.upsert",
      layer: {
        id: layerId,
        clipId,
        range: createFrameRange(masterFrame(45n), masterFrame(70n)),
        effects: [
          {
            id: id("effect-pro-color-0001"),
            name: "Color balance",
            ownership: "common",
            engine: null,
            capability: "unified",
            parameters: { warmth: 0.2 },
            fallback: "shared",
          },
        ],
      },
    });
    const state = readProfessionalTimelineState(result.snapshot);
    expect(affectedProfessionalCacheRanges(state, [layerId])).toEqual([{ start: 45n, end: 70n }]);
    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "adjustment.upsert",
        layer: {
          id: id("adjustment-pro-invalid-0001"),
          clipId,
          range: createFrameRange(masterFrame(45n), masterFrame(70n)),
          effects: [
            {
              id: id("effect-pro-native-0001"),
              name: "Native shader",
              ownership: "engine-native",
              engine: "hyperframes",
              capability: "native",
              parameters: {},
              fallback: null,
            },
          ],
        },
      }),
    ).toThrow("explicit bake or shared fallback");
  });

  it("stores advanced bridge ownership and verifies exact boundary coverage", () => {
    const timeline = professionalTimeline();
    const bridge: AdvancedBridgeDefinition = {
      id: id("bridge-pro-advanced-0001"),
      fromClipId: id("clip-pro-left-0001"),
      toClipId: id("clip-pro-middle-0001"),
      range: createFrameRange(masterFrame(35n), masterFrame(45n)),
      implementation: "shader",
      owner: "shared",
      outgoingHandleFrames: masterFrame(5n),
      incomingHandleFrames: masterFrame(5n),
      preRollFrames: masterFrame(2n),
      postRollFrames: masterFrame(2n),
      alpha: "premultiplied",
      audioEnvelope: "equal-power",
      experimental: true,
      fallback: "crossfade",
      boundaryQa: "passed",
    };
    const result = executeTimelineCommand(timeline, { kind: "bridge.advanced.upsert", bridge });
    expect(readProfessionalTimelineState(result.snapshot).advancedBridges[bridge.id]).toEqual(bridge);
    const report = validateBridgeBoundarySamples(
      bridge,
      Array.from({ length: 10 }, (_, index) => ({
        frame: masterFrame(35n + BigInt(index)),
        outgoingPresent: index < 6,
        incomingPresent: index > 3,
        alphaValid: true,
      })),
    );
    expect(report).toEqual({ passed: true, missingFrames: [], duplicateFrames: [], invalidAlphaFrames: [] });
  });
});

const professionalTimeline = (): TimelineSnapshotV1 => {
  const trackId = id("track-pro-video-0001");
  const base = createEmptyTimelineSnapshot({
    id: id("timeline-pro-main-0001"),
    projectId: id("project-pro-main-0001"),
    revisionId: id("revision-pro-main-0001"),
    name: "Professional timeline",
    fps: normalizeRational(30n, 1n),
  });
  const clips = [
    clip("clip-pro-left-0001", trackId, 0n, 40n, 100n),
    clip("clip-pro-middle-0001", trackId, 40n, 80n, 200n),
    clip("clip-pro-right-0001", trackId, 80n, 120n, 300n),
  ];
  const track: TrackSnapshot = {
    id: trackId,
    kind: "video",
    name: "V1",
    order: 0,
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    audioBusId: null,
    clipIds: clips.map((item) => item.id),
  };
  return {
    ...base,
    duration: masterFrame(120n),
    trackIds: [trackId],
    tracks: { [trackId]: track },
    clips: Object.fromEntries(clips.map((item) => [item.id, item])),
  };
};

const staticProfessionalTimeline = (): TimelineSnapshotV1 => {
  const timeline = professionalTimeline();
  return {
    ...timeline,
    clips: Object.fromEntries(
      Object.entries(timeline.clips).map(([clipId, item]) => [
        clipId,
        {
          ...item,
          sourceRange: createFrameRange(masterFrame(0n), masterFrame(1n)),
          availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(1n)),
        },
      ]),
    ),
  };
};

const clip = (
  value: string,
  trackId: StableEntityId,
  start: bigint,
  end: bigint,
  sourceStart: bigint,
): ClipSnapshot => ({
  id: id(value),
  trackId,
  assetId: id(`asset-${value}`),
  nestedSequenceId: null,
  engine: "remotion",
  name: value,
  range: createFrameRange(masterFrame(start), masterFrame(end)),
  sourceRange: createFrameRange(masterFrame(sourceStart), masterFrame(sourceStart + end - start)),
  sourceRate: normalizeRational(30n, 1n),
  speed: normalizeRational(1n, 1n),
  availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(1_000n)),
  linkGroupId: null,
  selectionGroupId: null,
  transitionInId: null,
  transitionOutId: null,
  keyframeIds: [],
  metadata: { capability: "unified" },
});

const id = (value: string): StableEntityId => stableEntityId(value);
const required = <T>(value: T | undefined | null): T => {
  if (value === undefined || value === null) throw new Error("Required fixture value is missing.");
  return value;
};
