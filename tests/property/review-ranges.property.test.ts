import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { executeReviewDocumentEdit } from "../../packages/review/src/index.js";
import { serializeBigInt, type TimelineDocument } from "../../packages/schema/src/index.js";

describe("P19 exact review range properties", () => {
  it("accepts every non-empty exact frame range contained by both comparison revisions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 998 }),
        fc.integer({ min: 1, max: 1000 }),
        (candidateStart, candidateEnd) => {
          const start = Math.min(candidateStart, candidateEnd - 1);
          const end = Math.max(start + 1, candidateEnd);
          const result = executeReviewDocumentEdit(
            timeline(),
            {
              kind: "review.comparison.create",
              comparison: {
                id: `comparison-property-${String(start)}-${String(end)}`,
                leftRevisionId: "revision-property-left",
                rightRevisionId: "revision-property-right",
                timelineId: "timeline-property-review",
                frameRange: {
                  startFrame: serializeBigInt(BigInt(start)),
                  endFrameExclusive: serializeBigInt(BigInt(end)),
                },
                mode: "side-by-side",
                linkedNavigation: true,
                split: 0.5,
                captureIds: [],
                createdAt: "2026-07-16T12:00:00.000Z",
              },
            },
            "revision-property-result",
          );
          expect(result.timeline.reviewState?.comparisons[0]?.frameRange).toEqual({
            startFrame: String(start),
            endFrameExclusive: String(end),
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects every comparison range that exceeds the exact timeline", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1001, max: 10_000 }), (end) => {
        expect(() =>
          executeReviewDocumentEdit(
            timeline(),
            {
              kind: "review.comparison.create",
              comparison: {
                id: `comparison-property-overflow-${String(end)}`,
                leftRevisionId: "revision-property-left",
                rightRevisionId: "revision-property-right",
                timelineId: "timeline-property-review",
                frameRange: {
                  startFrame: serializeBigInt(0n),
                  endFrameExclusive: serializeBigInt(BigInt(end)),
                },
                mode: "wipe",
                linkedNavigation: true,
                split: 0.5,
                captureIds: [],
                createdAt: "2026-07-16T12:00:00.000Z",
              },
            },
            "revision-property-result",
          ),
        ).toThrow(/outside the exact timeline/);
      }),
      { numRuns: 100 },
    );
  });
});

const timeline = (): TimelineDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-property-review",
  revisionId: "revision-property-left",
  timelineId: "timeline-property-review",
  fps: { numerator: serializeBigInt(30_000n), denominator: serializeBigInt(1_001n) },
  durationFrames: serializeBigInt(1_000n),
  tracks: [],
  audioBusIds: [],
  approvalReferenceIds: [],
});
