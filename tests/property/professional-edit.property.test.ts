import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  createEmptyTimelineSnapshot,
  createFrameRange,
  executeTimelineCommand,
  masterFrame,
  stableEntityId,
  type ClipSnapshot,
  type TimelineSnapshotV1,
} from "../../packages/timeline/src/index.js";

describe("P25 professional edit properties", () => {
  it("roll edits preserve total duration and restore byte-equivalent state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 2_000 }),
        fc.integer({ min: 2, max: 2_000 }),
        fc.nat(),
        (leftLength, rightLength, rawOffset) => {
          const timeline = twoClipTimeline(BigInt(leftLength), BigInt(rightLength));
          const minimum = 1n;
          const maximum = BigInt(leftLength + rightLength - 1);
          const boundary = minimum + (BigInt(rawOffset) % maximum);
          const result = executeTimelineCommand(timeline, {
            kind: "clips.roll",
            leftClipId: stableEntityId("clip-property-roll-left-0001"),
            rightClipId: stableEntityId("clip-property-roll-right-0001"),
            boundary: masterFrame(boundary),
            includeLinked: false,
          });
          expect(result.snapshot.duration).toBe(timeline.duration);
          expect(executeTimelineCommand(result.snapshot, result.inverse).snapshot).toEqual(timeline);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("constant-speed authority always persists a normalized rational and exact inverse", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 16 }),
        fc.integer({ min: 1, max: 16 }),
        (numerator, denominator) => {
          const timeline = twoClipTimeline(100n, 100n);
          const result = executeTimelineCommand(timeline, {
            kind: "clip.speed",
            clipId: stableEntityId("clip-property-roll-left-0001"),
            speed: normalizeRational(BigInt(numerator), BigInt(denominator)),
            reconcile: "preserve-timeline-duration",
            audioBehavior: "resample",
          });
          const speed = result.snapshot.clips[stableEntityId("clip-property-roll-left-0001")]?.speed;
          expect(speed).toEqual(normalizeRational(BigInt(numerator), BigInt(denominator)));
          expect(executeTimelineCommand(result.snapshot, result.inverse).snapshot).toEqual(timeline);
        },
      ),
      { numRuns: 100 },
    );
  });
});

const twoClipTimeline = (leftLength: bigint, rightLength: bigint): TimelineSnapshotV1 => {
  const trackId = stableEntityId("track-property-roll-0001");
  const left = clip("clip-property-roll-left-0001", trackId, 0n, leftLength, 2_000n);
  const right = clip("clip-property-roll-right-0001", trackId, leftLength, leftLength + rightLength, 6_000n);
  const base = createEmptyTimelineSnapshot({
    id: stableEntityId("timeline-property-roll-0001"),
    projectId: stableEntityId("project-property-roll-0001"),
    revisionId: stableEntityId("revision-property-roll-0001"),
    name: "Property roll",
    fps: normalizeRational(30n, 1n),
  });
  return {
    ...base,
    duration: masterFrame(leftLength + rightLength),
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
        clipIds: [left.id, right.id],
      },
    },
    clips: { [left.id]: left, [right.id]: right },
  };
};

const clip = (
  rawId: string,
  trackId: ClipSnapshot["trackId"],
  start: bigint,
  end: bigint,
  sourceStart: bigint,
): ClipSnapshot => ({
  id: stableEntityId(rawId),
  trackId,
  assetId: stableEntityId(`asset-${rawId}`),
  nestedSequenceId: null,
  engine: "shared",
  name: rawId,
  range: createFrameRange(masterFrame(start), masterFrame(end)),
  sourceRange: createFrameRange(masterFrame(sourceStart), masterFrame(sourceStart + end - start)),
  sourceRate: normalizeRational(30n, 1n),
  speed: normalizeRational(1n, 1n),
  availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(20_000n)),
  linkGroupId: null,
  selectionGroupId: null,
  transitionInId: null,
  transitionOutId: null,
  keyframeIds: [],
  metadata: {},
});
