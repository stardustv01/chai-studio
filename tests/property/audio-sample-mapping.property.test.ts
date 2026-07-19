import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sampleBoundaryForFrame, sampleRangeForFrames } from "../../packages/audio/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

describe("P16 audio sample mapping properties", () => {
  it("always covers the exact rational interval without truncating either boundary", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 100_000n }),
        fc.constantFrom(44_100, 48_000, 96_000),
        (start, duration, sampleRate) => {
          const fps = normalizeRational(30_000n, 1_001n);
          const end = start + duration;
          const range = sampleRangeForFrames(start, end, fps, sampleRate);
          expect(range.startSample).toBe(sampleBoundaryForFrame(start, fps, sampleRate, "floor"));
          expect(range.endSampleExclusive).toBe(sampleBoundaryForFrame(end, fps, sampleRate, "ceil"));
          expect(range.endSampleExclusive).toBeGreaterThanOrEqual(range.startSample);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
