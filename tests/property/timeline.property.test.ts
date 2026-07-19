import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  assertValidTimelineCore,
  buildTimelineDerivedIndexes,
  composeFrameTransforms,
  createEmptyTimelineSnapshot,
  createFrameRange,
  executeTimelineCommand,
  deserializeTimelineSnapshot,
  invertFrameTransform,
  mapFrameExact,
  masterFrame,
  queryClipsAtFrame,
  serializeTimelineSnapshot,
  stableEntityId,
  type ClipSnapshot,
  type StableEntityId,
  type TimelineSnapshotV1,
} from "../../packages/timeline/src/index.js";

describe("timeline command properties", () => {
  it("split preserves total timeline/source coverage and restores exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10_000 }),
        fc.integer({ min: 1, max: 9_999 }),
        (length, rawAt) => {
          const at = 1 + (rawAt % (length - 1));
          const timeline = singleClipTimeline(BigInt(length));
          const clipId = stableEntityId("clip-property-0001");
          const rightId = stableEntityId("clip-property-right-0001");
          const result = executeTimelineCommand(timeline, {
            kind: "clips.split",
            atFrame: masterFrame(BigInt(at)),
            splits: [{ clipId, rightClipId: rightId }],
          });
          const left = result.snapshot.clips[clipId];
          const right = result.snapshot.clips[rightId];
          expect(left?.range.end).toBe(right?.range.start);
          expect(left?.sourceRange.end).toBe(right?.sourceRange.start);
          expect(
            (left?.range.end ?? 0n) -
              (left?.range.start ?? 0n) +
              ((right?.range.end ?? 0n) - (right?.range.start ?? 0n)),
          ).toBe(BigInt(length));
          expect(executeTimelineCommand(result.snapshot, result.inverse).snapshot).toEqual(timeline);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("trim always produces a valid positive owner range and exact undo", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10_000 }),
        fc.integer({ min: 1, max: 9_999 }),
        fc.boolean(),
        (length, rawBoundary, trimIn) => {
          const boundary = 1 + (rawBoundary % (length - 1));
          const timeline = singleClipTimeline(BigInt(length));
          const result = executeTimelineCommand(timeline, {
            kind: "clips.trim",
            trims: [
              {
                clipId: stableEntityId("clip-property-0001"),
                edge: trimIn ? "in" : "out",
                toFrame: masterFrame(BigInt(boundary)),
              },
            ],
            ripple: false,
          });
          assertValidTimelineCore(result.snapshot);
          expect(executeTimelineCommand(result.snapshot, result.inverse).snapshot).toEqual(timeline);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("ripple-delete preserves ordering, non-overlap, validation, and exact undo", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 2, maxLength: 12 }),
        fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 2, maxLength: 12 }),
        fc.nat(),
        (durations, gaps, rawIndex) => {
          const timeline = sequenceTimeline(durations, gaps);
          const index = rawIndex % durations.length;
          const clipId = stableEntityId(`clip-sequence-${String(index).padStart(4, "0")}`);
          const result = executeTimelineCommand(timeline, {
            kind: "clips.ripple-delete",
            clipIds: [clipId],
          });
          assertValidTimelineCore(result.snapshot);
          const trackId = stableEntityId("track-property-0001");
          const ordered = result.snapshot.tracks[trackId]?.clipIds ?? [];
          for (let item = 1; item < ordered.length; item += 1) {
            const previous = result.snapshot.clips[ordered[item - 1] ?? stableEntityId("missing-prev")];
            const current = result.snapshot.clips[ordered[item] ?? stableEntityId("missing-next")];
            expect(previous?.range.end ?? 0n).toBeLessThanOrEqual(current?.range.start ?? 0n);
          }
          expect(executeTimelineCommand(result.snapshot, result.inverse).snapshot).toEqual(timeline);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("derived interval queries agree with a naive half-open scan", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 12 }),
        fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 1, maxLength: 12 }),
        fc.nat({ max: 1_000 }),
        (durations, gaps, frameInput) => {
          const timeline = sequenceTimeline(durations, gaps);
          const frame = masterFrame(BigInt(frameInput) % (timeline.duration + 1n));
          const indexes = buildTimelineDerivedIndexes(timeline);
          const expected = Object.values(timeline.clips)
            .filter((clip) => clip.range.start <= frame && frame < clip.range.end)
            .sort((left, right) => (left.range.start < right.range.start ? -1 : 1))
            .map((clip) => clip.id);
          expect(queryClipsAtFrame(indexes, frame)).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("round-trips canonical snapshots byte-stably and preserves selection through movement", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 12 }),
        fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 1, maxLength: 12 }),
        (durations, gaps) => {
          const timeline = sequenceTimeline(durations, gaps);
          const bytes = serializeTimelineSnapshot(timeline);
          const reopened = deserializeTimelineSnapshot(bytes);
          expect(reopened).toEqual(timeline);
          expect(serializeTimelineSnapshot(reopened)).toBe(bytes);

          const clipId = timeline.trackIds.flatMap((trackId) => timeline.tracks[trackId]?.clipIds ?? [])[0];
          if (clipId === undefined) throw new Error("Generated timeline contains no clip.");
          const selected = executeTimelineCommand(timeline, {
            kind: "selection.set",
            entityIds: [clipId],
            mode: "replace",
            primaryId: clipId,
          });
          const clipValue = selected.snapshot.clips[clipId];
          if (clipValue === undefined) throw new Error("Selected clip is missing.");
          const moved = executeTimelineCommand(selected.snapshot, {
            kind: "clips.move",
            moves: [{ clipId, trackId: clipValue.trackId, start: clipValue.range.start }],
          });
          expect(moved.snapshot.selection.selectedIds).toEqual([clipId]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("composes and inverts nested rational frame mappings exactly on aligned frames", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 100 }),
        (a, b, c, d, factor) => {
          const first = {
            inputOrigin: masterFrame(0n),
            outputOrigin: masterFrame(10n),
            scale: normalizeRational(BigInt(a), BigInt(b)),
          };
          const second = {
            inputOrigin: masterFrame(10n),
            outputOrigin: masterFrame(20n),
            scale: normalizeRational(BigInt(c), BigInt(d)),
          };
          const composed = composeFrameTransforms(first, second);
          const input = masterFrame(BigInt(b * d * factor));
          const nested = mapFrameExact(second, mapFrameExact(first, input, "nearest"), "nearest");
          expect(mapFrameExact(composed, input, "nearest")).toBe(nested);
          expect(mapFrameExact(invertFrameTransform(composed), nested, "nearest")).toBe(input);
        },
      ),
      { numRuns: 100 },
    );
  });
});

const singleClipTimeline = (length: bigint): TimelineSnapshotV1 => sequenceTimeline([Number(length)], [0]);

const sequenceTimeline = (durations: readonly number[], gaps: readonly number[]): TimelineSnapshotV1 => {
  const trackId = stableEntityId("track-property-0001");
  let cursor = 0n;
  const clips = durations.map((duration, index) => {
    cursor += BigInt(gaps[index % gaps.length] ?? 0);
    const start = cursor;
    const end = start + BigInt(duration);
    cursor = end;
    return clip(stableEntityId(`clip-sequence-${String(index).padStart(4, "0")}`), trackId, start, end);
  });
  if (clips.length === 1) {
    const only = clips[0];
    if (only === undefined) throw new Error("Single clip fixture failed.");
    clips[0] = { ...only, id: stableEntityId("clip-property-0001") };
  }
  const base = createEmptyTimelineSnapshot({
    id: stableEntityId("timeline-property-0001"),
    projectId: stableEntityId("project-property-0001"),
    revisionId: stableEntityId("revision-property-0001"),
    name: "Property timeline",
    fps: normalizeRational(30n, 1n),
  });
  const clipRecords = Object.fromEntries(clips.map((item) => [item.id, item]));
  return {
    ...base,
    duration: masterFrame(cursor + 10n),
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
        clipIds: clips.map((item) => item.id),
      },
    },
    clips: clipRecords,
  };
};

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
  availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(20_000n)),
  linkGroupId: null,
  selectionGroupId: null,
  transitionInId: null,
  transitionOutId: null,
  keyframeIds: [],
  metadata: {},
});
