import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  createEmptyTimelineSnapshot,
  createFrameRange,
  executeTimelineCommand,
  masterFrame,
  stableEntityId,
  validateTimelineCore,
  type AutomationLaneSnapshot,
  type ClipSnapshot,
  type KeyframeSnapshot,
  type StableEntityId,
  type TimelineSnapshotV1,
} from "../../packages/timeline/src/index.js";

describe("keyframe and automation commands", () => {
  it("adds, updates, removes, and restores keyframes through an explicit lane", () => {
    const timeline = keyframeTimeline();
    const clipId = stableEntityId("clip-key-0001");
    const lane = automationLane(stableEntityId("lane-key-0001"), clipId);
    const withLane = executeTimelineCommand(timeline, { kind: "automation-lane.add", lane });
    const keyframe = numericKeyframe(stableEntityId("keyframe-key-0001"), clipId, 25n);
    const added = executeTimelineCommand(withLane.snapshot, {
      kind: "keyframe.add",
      keyframe,
      automationLaneId: lane.id,
    });
    expect(added.snapshot.clips[clipId]?.keyframeIds).toEqual([keyframe.id]);
    expect(added.snapshot.automation[lane.id]?.keyframeIds).toEqual([keyframe.id]);

    const updated = executeTimelineCommand(added.snapshot, {
      kind: "keyframe.update",
      keyframeId: keyframe.id,
      changes: { frame: masterFrame(40n), value: 0.75, interpolation: "bezier" },
    });
    expect(updated.snapshot.keyframes[keyframe.id]).toMatchObject({ frame: 40n, value: 0.75 });
    const removed = executeTimelineCommand(updated.snapshot, {
      kind: "keyframes.remove",
      keyframeIds: [keyframe.id],
    });
    expect(removed.snapshot.keyframes[keyframe.id]).toBeUndefined();
    expect(removed.snapshot.clips[clipId]?.keyframeIds).toEqual([]);
    expect(removed.snapshot.automation[lane.id]?.keyframeIds).toEqual([]);
    expect(executeTimelineCommand(removed.snapshot, removed.inverse).snapshot).toEqual(updated.snapshot);
  });

  it("requires explicit keyframe destruction when removing a non-empty lane", () => {
    const populated = timelineWithKeyframe(keyframeTimeline(), "clip-key-0001", 25n);
    const laneId = stableEntityId("lane-key-0001");
    expect(() =>
      executeTimelineCommand(populated, {
        kind: "automation-lanes.remove",
        laneIds: [laneId],
        removeKeyframes: false,
      }),
    ).toThrow(/explicit keyframe removal/);
    const removed = executeTimelineCommand(populated, {
      kind: "automation-lanes.remove",
      laneIds: [laneId],
      removeKeyframes: true,
    });
    expect(removed.snapshot.automation[laneId]).toBeUndefined();
    expect(Object.keys(removed.snapshot.keyframes)).toEqual([]);
  });

  it("rejects unreachable and owner-outside keyframes", () => {
    const timeline = keyframeTimeline();
    const clipId = stableEntityId("clip-key-0001");
    const unreachable = numericKeyframe(stableEntityId("keyframe-orphan-0001"), clipId, 25n);
    expect(
      validateTimelineCore({
        ...timeline,
        keyframes: { [unreachable.id]: unreachable },
      }).issues.map((issue) => issue.code),
    ).toContain("timeline.keyframe.relation-missing");

    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "keyframe.add",
        keyframe: numericKeyframe(stableEntityId("keyframe-outside-0001"), clipId, 110n),
        automationLaneId: null,
      }),
    ).toThrow(/outside its timeline or clip owner range/);
  });
});

describe("keyframe ownership during timeline edits", () => {
  it("moves owned keyframes by the same exact clip delta", () => {
    const timeline = timelineWithKeyframe(keyframeTimeline(), "clip-key-0001", 25n);
    const moved = executeTimelineCommand(timeline, {
      kind: "clips.move",
      moves: [
        {
          clipId: stableEntityId("clip-key-0001"),
          trackId: stableEntityId("track-key-0002"),
          start: masterFrame(20n),
        },
      ],
    });
    expect(moved.snapshot.keyframes[stableEntityId("keyframe-key-0001")]?.frame).toBe(45n);
  });

  it("shifts later owned keyframes during insert and ripple-delete", () => {
    const timeline = timelineWithKeyframe(keyframeTimeline(), "clip-key-0002", 130n);
    const insertedClip = clip(
      stableEntityId("clip-key-insert-0001"),
      stableEntityId("track-key-0001"),
      100n,
      110n,
    );
    const inserted = executeTimelineCommand(timeline, { kind: "clip.insert", clip: insertedClip });
    expect(inserted.snapshot.keyframes[stableEntityId("keyframe-key-0001")]?.frame).toBe(140n);

    const ripple = executeTimelineCommand(timeline, {
      kind: "clips.ripple-delete",
      clipIds: [stableEntityId("clip-key-0001")],
    });
    expect(ripple.snapshot.keyframes[stableEntityId("keyframe-key-0001")]?.frame).toBe(30n);
  });
});

const timelineWithKeyframe = (
  timeline: TimelineSnapshotV1,
  ownerClipId: string,
  frame: bigint,
): TimelineSnapshotV1 => {
  const clipId = stableEntityId(ownerClipId);
  const lane = automationLane(stableEntityId("lane-key-0001"), clipId);
  const withLane = executeTimelineCommand(timeline, { kind: "automation-lane.add", lane });
  return executeTimelineCommand(withLane.snapshot, {
    kind: "keyframe.add",
    keyframe: numericKeyframe(stableEntityId("keyframe-key-0001"), clipId, frame),
    automationLaneId: lane.id,
  }).snapshot;
};

const keyframeTimeline = (): TimelineSnapshotV1 => {
  const track1 = stableEntityId("track-key-0001");
  const track2 = stableEntityId("track-key-0002");
  const clip1 = clip(stableEntityId("clip-key-0001"), track1, 0n, 100n);
  const clip2 = clip(stableEntityId("clip-key-0002"), track1, 120n, 170n);
  const base = createEmptyTimelineSnapshot({
    id: stableEntityId("timeline-key-0001"),
    projectId: stableEntityId("project-key-0001"),
    revisionId: stableEntityId("revision-key-0001"),
    name: "Keyframe timeline",
    fps: normalizeRational(30n, 1n),
  });
  return {
    ...base,
    duration: masterFrame(200n),
    trackIds: [track1, track2],
    tracks: {
      [track1]: track(track1, 0, [clip1.id, clip2.id]),
      [track2]: track(track2, 1, []),
    },
    clips: { [clip1.id]: clip1, [clip2.id]: clip2 },
  };
};

const automationLane = (id: StableEntityId, ownerEntityId: StableEntityId): AutomationLaneSnapshot => ({
  id,
  ownerEntityId,
  propertyPath: "opacity",
  keyframeIds: [],
  authority: "shared",
});

const numericKeyframe = (
  id: StableEntityId,
  ownerEntityId: StableEntityId,
  frame: bigint,
): KeyframeSnapshot => ({
  id,
  ownerEntityId,
  propertyPath: "opacity",
  frame: masterFrame(frame),
  value: 0.5,
  interpolation: "linear",
  inTangent: null,
  outTangent: null,
  authority: "shared",
  preserveNativeAnimation: false,
});

const track = (id: StableEntityId, order: number, clipIds: readonly StableEntityId[]) => ({
  id,
  kind: "video" as const,
  name: `V${String(order + 1)}`,
  order,
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  audioBusId: null,
  clipIds,
});

const clip = (id: StableEntityId, trackId: StableEntityId, start: bigint, end: bigint): ClipSnapshot => ({
  id,
  trackId,
  assetId: stableEntityId(`asset-${id}`),
  nestedSequenceId: null,
  engine: "shared",
  name: id,
  range: createFrameRange(masterFrame(start), masterFrame(end)),
  sourceRange: createFrameRange(masterFrame(0n), masterFrame(end - start)),
  sourceRate: normalizeRational(30n, 1n),
  speed: normalizeRational(1n, 1n),
  availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(500n)),
  linkGroupId: null,
  selectionGroupId: null,
  transitionInId: null,
  transitionOutId: null,
  keyframeIds: [],
  metadata: {},
});
