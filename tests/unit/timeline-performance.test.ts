import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/rational.js";
import {
  createEmptyTimelineSnapshot,
  diffTimelineSnapshots,
  stableEntityId,
  TimelineDerivedIndexCache,
} from "../../packages/timeline/src/index.js";

describe("P26 timeline performance fast paths", () => {
  const timeline = createEmptyTimelineSnapshot({
    id: stableEntityId("timeline-performance-test"),
    projectId: stableEntityId("project-performance-test"),
    revisionId: stableEntityId("revision-performance-test"),
    name: "Performance test",
    fps: normalizeRational(30n, 1n),
  });

  it("reuses derived indexes only for the exact immutable snapshot object", () => {
    const cache = new TimelineDerivedIndexCache();
    const first = cache.get(timeline);
    expect(cache.get(timeline)).toBe(first);
    expect(cache.snapshot()).toEqual({ hits: 1, misses: 1, hitRate: 0.5 });
  });

  it("returns an exact empty diff through the immutable identity fast path", () => {
    expect(diffTimelineSnapshots(timeline, timeline)).toEqual({
      beforeRevisionId: timeline.revisionId,
      afterRevisionId: timeline.revisionId,
      changes: [],
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      summary: "0 added, 0 removed, 0 modified",
    });
  });
});
