import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  audibleTracks,
  createEmptyTimelineSnapshot,
  createFrameRange,
  masterFrame,
  orderedAudioBuses,
  orderedTracks,
  stableEntityId,
  validateClipPlacement,
  validateTimelineCore,
  visualStack,
  type ClipSnapshot,
  type TimelineSnapshotV1,
} from "../../packages/timeline/src/index.js";

describe("track order and derived visibility/audibility", () => {
  it("derives stable order from explicit order plus ID tie-breaks", () => {
    const timeline = validTimeline();
    expect(orderedTracks(timeline).map((track) => track.id)).toEqual([
      "track-video-0001",
      "track-audio-0001",
    ]);
    expect(visualStack(timeline).map((track) => track.id)).toEqual(["track-video-0001"]);
    expect(audibleTracks(timeline).map((track) => track.id)).toEqual(["track-audio-0001"]);
    expect(orderedAudioBuses(timeline).map((bus) => bus.id)).toEqual(["bus-main-0001"]);
  });

  it("reports registry, order, route, and type constraints with repair context", () => {
    const baseline = validTimeline();
    const videoTrack = baseline.tracks[stableEntityId("track-video-0001")];
    if (videoTrack === undefined) throw new Error("Fixture video track is missing.");
    const invalid: TimelineSnapshotV1 = {
      ...baseline,
      trackIds: [stableEntityId("track-video-0001"), stableEntityId("track-video-0001")],
      tracks: {
        ...baseline.tracks,
        [stableEntityId("track-video-0001")]: {
          ...videoTrack,
          order: 1,
          audioBusId: stableEntityId("bus-missing-0001"),
        },
      },
    };
    const report = validateTimelineCore(invalid);
    expect(report.passed).toBe(false);
    expect(report.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "timeline.track.id-duplicate",
        "timeline.track.order-duplicate",
        "timeline.track.audio-bus-forbidden",
        "timeline.track.audio-bus-unknown",
        "timeline.tracks.relation-missing",
      ]),
    );
    expect(report.issues.every((item) => item.repairHint.length > 10)).toBe(true);
  });
});

describe("clip placement, handles, and nested boundaries", () => {
  it("accepts a valid coordinated snapshot and rejects non-audio overlap", () => {
    const timeline = validTimeline();
    expect(validateTimelineCore(timeline)).toEqual({ passed: true, issues: [] });
    const original = timeline.clips[stableEntityId("clip-video-0001")];
    if (original === undefined) throw new Error("Fixture clip is missing.");
    const overlapping: ClipSnapshot = {
      ...original,
      id: stableEntityId("clip-video-0002"),
      range: createFrameRange(masterFrame(50n), masterFrame(150n)),
    };
    const placement = validateClipPlacement(timeline, overlapping);
    expect(placement.allowed).toBe(false);
    const overlapIssue = placement.issues.find((item) => item.code === "timeline.clip.overlap");
    expect(overlapIssue?.conflictingEntityIds).toContain("clip-video-0001");
    expect(overlapIssue?.conflictingEntityIds).toContain("track-video-0001");
  });

  it("returns repairable handle and nested-sequence conflicts", () => {
    const timeline = validTimeline();
    const original = timeline.clips[stableEntityId("clip-video-0001")];
    if (original === undefined) throw new Error("Fixture clip is missing.");
    const badHandles: ClipSnapshot = {
      ...original,
      id: stableEntityId("clip-video-0002"),
      range: createFrameRange(masterFrame(100n), masterFrame(150n)),
      sourceRange: createFrameRange(masterFrame(190n), masterFrame(250n)),
    };
    expect(validateClipPlacement(timeline, badHandles).issues.map((item) => item.code)).toContain(
      "timeline.clip.handles-exceeded",
    );

    const nestedId = stableEntityId("nested-sequence-0001");
    const nestedClip: ClipSnapshot = {
      ...badHandles,
      assetId: null,
      nestedSequenceId: nestedId,
      sourceRange: createFrameRange(masterFrame(0n), masterFrame(120n)),
      availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(200n)),
      sourceRate: normalizeRational(24n, 1n),
    };
    const owningTrack = timeline.tracks[nestedClip.trackId];
    if (owningTrack === undefined) throw new Error("Fixture owning track is missing.");
    const nestedTimeline: TimelineSnapshotV1 = {
      ...timeline,
      nestedSequences: {
        [nestedId]: {
          id: nestedId,
          timelineId: stableEntityId("timeline-nested-0001"),
          rate: normalizeRational(30n, 1n),
          duration: masterFrame(100n),
        },
      },
      clips: { ...timeline.clips, [nestedClip.id]: nestedClip },
      tracks: {
        ...timeline.tracks,
        [nestedClip.trackId]: {
          ...owningTrack,
          clipIds: [...owningTrack.clipIds, nestedClip.id],
        },
      },
    };
    const report = validateTimelineCore(nestedTimeline);
    expect(report.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["timeline.nested.boundary-exceeded", "timeline.nested.rate-mismatch"]),
    );
  });
});

const validTimeline = (): TimelineSnapshotV1 => {
  const timelineId = stableEntityId("timeline-main-0001");
  const projectId = stableEntityId("project-main-0001");
  const revisionId = stableEntityId("revision-main-0001");
  const videoTrackId = stableEntityId("track-video-0001");
  const audioTrackId = stableEntityId("track-audio-0001");
  const busId = stableEntityId("bus-main-0001");
  const clipId = stableEntityId("clip-video-0001");
  const assetId = stableEntityId("asset-video-0001");
  const base = createEmptyTimelineSnapshot({
    id: timelineId,
    projectId,
    revisionId,
    name: "Main",
    fps: normalizeRational(30n, 1n),
  });
  const clip: ClipSnapshot = {
    id: clipId,
    trackId: videoTrackId,
    assetId,
    nestedSequenceId: null,
    engine: "shared",
    name: "Opening",
    range: createFrameRange(masterFrame(0n), masterFrame(100n)),
    sourceRange: createFrameRange(masterFrame(10n), masterFrame(110n)),
    sourceRate: normalizeRational(30n, 1n),
    speed: normalizeRational(1n, 1n),
    availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(200n)),
    linkGroupId: null,
    selectionGroupId: null,
    transitionInId: null,
    transitionOutId: null,
    keyframeIds: [],
    metadata: {},
  };
  return {
    ...base,
    duration: masterFrame(300n),
    trackIds: [videoTrackId, audioTrackId],
    tracks: {
      [videoTrackId]: {
        id: videoTrackId,
        kind: "video",
        name: "V1",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        audioBusId: null,
        clipIds: [clipId],
      },
      [audioTrackId]: {
        id: audioTrackId,
        kind: "audio",
        name: "A1",
        order: 1,
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        audioBusId: busId,
        clipIds: [],
      },
    },
    audioBusIds: [busId],
    audioBuses: {
      [busId]: { id: busId, name: "Main", order: 0, muted: false, solo: false, gain: 1 },
    },
    clips: { [clipId]: clip },
  };
};
