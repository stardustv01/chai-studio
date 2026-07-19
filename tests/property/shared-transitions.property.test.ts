import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createPreviewFrameRange,
  sampleSharedTransition,
  sharedTransitionBoundaryOwner,
  type SharedTransitionKind,
} from "../../packages/preview/src/index.js";

const transitionKinds: readonly SharedTransitionKind[] = [
  "hard-cut",
  "dissolve",
  "dip",
  "wipe",
  "push",
  "slide",
  "zoom",
  "blur",
];

describe("P12 shared transition properties", () => {
  it("assigns exactly one boundary owner and never produces a blank included frame", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...transitionKinds),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 120 }),
        (kind, start, duration) => {
          const transition = {
            transitionId: `transition-${kind}-0001`,
            kind,
            range: createPreviewFrameRange(start.toString(), (start + duration).toString()),
            outgoingClipId: "clip-outgoing-0001",
            incomingClipId: "clip-incoming-0001",
          };
          expect(sharedTransitionBoundaryOwner(transition, (start - 1).toString())).toBe("outgoing");
          expect(sharedTransitionBoundaryOwner(transition, start.toString())).toBe("transition");
          expect(sharedTransitionBoundaryOwner(transition, (start + duration).toString())).toBe("incoming");
          for (let frame = start; frame < start + duration; frame += 1) {
            const sample = sampleSharedTransition(transition, frame.toString());
            expect(sample.owner).toBe("transition");
            expect(sample.frame).toBe(frame.toString());
            expect(sample.progress).toBeGreaterThanOrEqual(0);
            expect(sample.progress).toBeLessThanOrEqual(1);
            expect(sample.outgoingWeight + sample.incomingWeight + sample.matteWeight).toBeGreaterThan(0);
            expect(
              [
                sample.outgoingWeight,
                sample.incomingWeight,
                sample.matteWeight,
                sample.outgoingTransform.translateX,
                sample.incomingTransform.translateY,
              ].every(Number.isFinite),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 80 },
    );
  });

  it("is deterministic and reaches the incoming endpoint for multi-frame transitions", () => {
    fc.assert(
      fc.property(fc.constantFrom(...transitionKinds), fc.integer({ min: 2, max: 120 }), (kind, duration) => {
        const transition = {
          transitionId: `transition-${kind}-0002`,
          kind,
          range: createPreviewFrameRange("0", duration.toString()),
          outgoingClipId: "clip-outgoing-0002",
          incomingClipId: "clip-incoming-0002",
        };
        const first = sampleSharedTransition(transition, "0");
        const last = sampleSharedTransition(transition, (duration - 1).toString());
        expect(sampleSharedTransition(transition, "0")).toEqual(first);
        expect(first.progress).toBe(0);
        expect(last.progress).toBe(1);
        expect(last.incomingWeight).toBeGreaterThan(0);
      }),
      { numRuns: 80 },
    );
  });
});
