import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  collectSnapCandidates,
  createEmptyTimelineSnapshot,
  createFrameRange,
  masterFrame,
  resolveSnap,
  stableEntityId,
  type TimelineSnapshotV1,
} from "../../packages/timeline/src/index.js";

describe("frame-exact snapping candidates", () => {
  it("collects every supported source in deterministic priority order", () => {
    const timeline = snappingTimeline();
    const candidates = collectSnapCandidates(timeline, {
      playhead: masterFrame(100n),
      userGuides: [{ id: stableEntityId("guide-user-0001"), frame: masterFrame(100n), label: "Beat" }],
      transcriptPhrases: [
        {
          id: stableEntityId("phrase-word-0001"),
          range: createFrameRange(masterFrame(40n), masterFrame(60n)),
          text: "Hello world",
        },
      ],
    });
    expect(new Set(candidates.map((candidate) => candidate.kind))).toEqual(
      new Set([
        "user-guide",
        "playhead",
        "marker",
        "clip-boundary",
        "caption-boundary",
        "phrase-boundary",
        "keyframe",
      ]),
    );
    expect(
      candidates.filter((candidate) => candidate.frame === 100n).map((candidate) => candidate.kind),
    ).toEqual(["user-guide", "playhead", "marker", "clip-boundary", "caption-boundary", "keyframe"]);
  });

  it("chooses nearest distance, then frozen priority, and supports kind toggles", () => {
    const timeline = snappingTimeline();
    const candidates = collectSnapCandidates(timeline, {
      playhead: masterFrame(100n),
      userGuides: [{ id: stableEntityId("guide-user-0001"), frame: masterFrame(100n), label: "Beat" }],
      transcriptPhrases: [],
    });
    const snapped = resolveSnap(masterFrame(98n), candidates, { threshold: masterFrame(3n) });
    expect(snapped).toMatchObject({
      snapped: true,
      outputFrame: 100n,
      delta: 2n,
      candidate: { kind: "user-guide", id: "guide:guide-user-0001" },
    });
    const clipOnly = resolveSnap(masterFrame(98n), candidates, {
      threshold: masterFrame(3n),
      enabledKinds: new Set(["clip-boundary"]),
    });
    expect(clipOnly.candidate?.kind).toBe("clip-boundary");
    expect(resolveSnap(masterFrame(90n), candidates, { threshold: masterFrame(3n) }).snapped).toBe(false);
    expect(() => resolveSnap(masterFrame(90n), candidates, { threshold: masterFrame(-1n, true) })).toThrow(
      /threshold/,
    );
  });
});

const snappingTimeline = (): TimelineSnapshotV1 => {
  const timeline = createEmptyTimelineSnapshot({
    id: stableEntityId("timeline-snap-0001"),
    projectId: stableEntityId("project-snap-0001"),
    revisionId: stableEntityId("revision-snap-0001"),
    name: "Snap",
    fps: normalizeRational(30n, 1n),
  });
  const trackId = stableEntityId("track-video-0001");
  const clipId = stableEntityId("clip-video-0001");
  const markerId = stableEntityId("marker-beat-0001");
  const captionId = stableEntityId("caption-line-0001");
  const keyframeId = stableEntityId("keyframe-opacity-0001");
  return {
    ...timeline,
    duration: masterFrame(300n),
    trackIds: [trackId],
    tracks: {
      [trackId]: {
        id: trackId,
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
    },
    clips: {
      [clipId]: {
        id: clipId,
        trackId,
        assetId: stableEntityId("asset-video-0001"),
        nestedSequenceId: null,
        engine: "shared",
        name: "Opening",
        range: createFrameRange(masterFrame(0n), masterFrame(100n)),
        sourceRange: createFrameRange(masterFrame(0n), masterFrame(100n)),
        sourceRate: normalizeRational(30n, 1n),
        speed: normalizeRational(1n, 1n),
        availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(200n)),
        linkGroupId: null,
        selectionGroupId: null,
        transitionInId: null,
        transitionOutId: null,
        keyframeIds: [keyframeId],
        metadata: {},
      },
    },
    markers: {
      [markerId]: {
        id: markerId,
        frame: masterFrame(100n),
        duration: masterFrame(0n),
        label: "Beat marker",
        category: "guide",
        issueSeverity: null,
        annotationReferenceIds: [],
        ripplePolicy: "anchored-time",
      },
    },
    captions: {
      [captionId]: {
        id: captionId,
        trackId,
        range: createFrameRange(masterFrame(100n), masterFrame(130n)),
        text: "Caption",
        speakerId: null,
        wordTimingIds: [],
      },
    },
    keyframes: {
      [keyframeId]: {
        id: keyframeId,
        ownerEntityId: clipId,
        propertyPath: "opacity",
        frame: masterFrame(100n),
        value: 1,
        interpolation: "linear",
        inTangent: null,
        outTangent: null,
        authority: "shared",
        preserveNativeAnimation: false,
      },
    },
  };
};
