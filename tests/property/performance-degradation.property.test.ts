import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { resolvePreviewDegradation } from "../../packages/preview/src/index.js";

describe("P26 performance and degradation properties", () => {
  it("never claims frame-perfect real time for any dropped-frame count", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom("nominal", "elevated", "critical" as const),
        fc.boolean(),
        (droppedFrames, loadClass, renderRangeAvailable) => {
          const state = resolvePreviewDegradation({ droppedFrames, loadClass, renderRangeAvailable });
          expect(state.framePerfectRealtimeClaimed).toBe(false);
          expect(state.reversible).toBe(true);
          expect(state.previousLevel).toBeLessThanOrEqual(state.level);
          expect(state.nextLevel).toBeGreaterThanOrEqual(state.level);
        },
      ),
      { numRuns: 250 },
    );
  });
});
