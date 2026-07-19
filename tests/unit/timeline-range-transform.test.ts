import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  addFrames,
  composeFrameTransforms,
  createEmptyTimelineSnapshot,
  createFrameRange,
  createTimelineSourceTransform,
  formatTimecode,
  frameRangeContains,
  frameRangeDuration,
  frameRangeFromDuration,
  frameRangesOverlap,
  intersectFrameRanges,
  invertFrameTransform,
  mapFrameExact,
  mapRangeExact,
  masterFrame,
  maximumMasterFrame,
  stableEntityId,
  translateFrameRange,
} from "../../packages/timeline/src/index.js";

describe("integer master-frame and half-open range primitives", () => {
  it("uses exact bigint authority and rejects floating, negative, empty, and overflowing state", () => {
    expect(masterFrame(42n)).toBe(42n);
    expect(() => masterFrame(1.5 as unknown as bigint)).toThrow(/bigint/);
    expect(() => masterFrame(-1n)).toThrow(/negative/);
    expect(() => masterFrame(maximumMasterFrame + 1n)).toThrow(/256-bit/);
    expect(() => createFrameRange(masterFrame(5n), masterFrame(5n))).toThrow(/positive/);
    expect(() => frameRangeFromDuration(masterFrame(0n), masterFrame(0n))).toThrow(/Duration/);
  });

  it("honors half-open containment, adjacency, intersection, duration, and bounded translation", () => {
    const left = createFrameRange(masterFrame(10n), masterFrame(20n));
    const adjacent = createFrameRange(masterFrame(20n), masterFrame(30n));
    const overlap = createFrameRange(masterFrame(15n), masterFrame(25n));
    expect(frameRangeContains(left, masterFrame(10n))).toBe(true);
    expect(frameRangeContains(left, masterFrame(19n))).toBe(true);
    expect(frameRangeContains(left, masterFrame(20n))).toBe(false);
    expect(frameRangesOverlap(left, adjacent)).toBe(false);
    expect(frameRangesOverlap(left, overlap)).toBe(true);
    expect(intersectFrameRanges(left, overlap)).toEqual({ start: 15n, end: 20n });
    expect(intersectFrameRanges(left, adjacent)).toBeNull();
    expect(frameRangeDuration(left)).toBe(10n);
    expect(translateFrameRange(left, masterFrame(5n))).toEqual({ start: 15n, end: 25n });
    expect(() => addFrames(maximumMasterFrame, masterFrame(1n))).toThrow(/256-bit/);
  });
});

describe("exact rational timeline and source transforms", () => {
  it("maps NTSC rates and non-unit speed with explicit floor and ceiling boundaries", () => {
    const identity23976 = createTimelineSourceTransform({
      timelineOrigin: masterFrame(0n),
      sourceOrigin: masterFrame(100n),
      timelineRate: normalizeRational(24_000n, 1_001n),
      sourceRate: normalizeRational(24_000n, 1_001n),
      speed: normalizeRational(1n, 1n),
    });
    expect(mapFrameExact(identity23976, masterFrame(24n), "floor")).toBe(124n);

    const double5994 = createTimelineSourceTransform({
      timelineOrigin: masterFrame(0n),
      sourceOrigin: masterFrame(0n),
      timelineRate: normalizeRational(30_000n, 1_001n),
      sourceRate: normalizeRational(60_000n, 1_001n),
      speed: normalizeRational(1n, 1n),
    });
    expect(mapFrameExact(double5994, masterFrame(300n), "floor")).toBe(600n);

    const halfSpeed = createTimelineSourceTransform({
      timelineOrigin: masterFrame(0n),
      sourceOrigin: masterFrame(0n),
      timelineRate: normalizeRational(30n, 1n),
      sourceRate: normalizeRational(30n, 1n),
      speed: normalizeRational(1n, 2n),
    });
    expect(mapRangeExact(halfSpeed, createFrameRange(masterFrame(1n), masterFrame(5n)))).toEqual({
      start: 0n,
      end: 3n,
    });
    expect(mapFrameExact(invertFrameTransform(halfSpeed), masterFrame(3n), "floor")).toBe(6n);
  });

  it("composes nested sequence rates exactly and rejects disconnected origins", () => {
    const first = createTimelineSourceTransform({
      timelineOrigin: masterFrame(0n),
      sourceOrigin: masterFrame(10n),
      timelineRate: normalizeRational(24n, 1n),
      sourceRate: normalizeRational(30n, 1n),
      speed: normalizeRational(1n, 1n),
    });
    const second = createTimelineSourceTransform({
      timelineOrigin: masterFrame(10n),
      sourceOrigin: masterFrame(100n),
      timelineRate: normalizeRational(30n, 1n),
      sourceRate: normalizeRational(60n, 1n),
      speed: normalizeRational(1n, 1n),
    });
    const nested = composeFrameTransforms(first, second);
    expect(nested.scale).toEqual(normalizeRational(5n, 2n));
    expect(mapFrameExact(nested, masterFrame(24n), "floor")).toBe(160n);
    expect(() => composeFrameTransforms(first, { ...second, inputOrigin: masterFrame(11n) })).toThrow(
      /origins/,
    );
  });

  it("keeps drop-frame timecode as display-only formatting", () => {
    const ntsc2997 = normalizeRational(30_000n, 1_001n);
    const ntsc5994 = normalizeRational(60_000n, 1_001n);
    expect(formatTimecode(masterFrame(1_800n), ntsc2997, true).text).toBe("00:01:00;02");
    expect(formatTimecode(masterFrame(17_982n), ntsc2997, true).text).toBe("00:10:00;00");
    expect(formatTimecode(masterFrame(3_600n), ntsc5994, true).text).toBe("00:01:00;04");
    expect(formatTimecode(masterFrame(24n), normalizeRational(24_000n, 1_001n), false).text).toBe(
      "00:00:01:00",
    );
    expect(() => formatTimecode(masterFrame(24n), normalizeRational(24n, 1n), true)).toThrow(/Drop-frame/);
  });
});

describe("stable immutable timeline snapshot identity", () => {
  it("uses entity maps and ID lists rather than positional relationships", () => {
    const timeline = createEmptyTimelineSnapshot({
      id: stableEntityId("timeline-main-0001"),
      projectId: stableEntityId("project-main-0001"),
      revisionId: stableEntityId("revision-main-0001"),
      name: "Main",
      fps: normalizeRational(30_000n, 1_001n),
    });
    expect(timeline).toMatchObject({
      schemaVersion: "1.0.0",
      duration: 0n,
      trackIds: [],
      tracks: {},
      clips: {},
    });
    expect(() => stableEntityId("1-position-derived")).toThrow(/stable entity ID/);
  });
});
