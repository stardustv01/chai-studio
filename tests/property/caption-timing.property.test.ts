import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { millisecondsToLanguageRange } from "../../packages/captions/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

describe("P17 exact timed-language mapping properties", () => {
  it("keeps every positive millisecond interval inside a non-empty half-open sample/frame range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 86_400_000 }),
        fc.integer({ min: 1, max: 60_000 }),
        fc.constantFrom(
          normalizeRational(24n, 1n),
          normalizeRational(25n, 1n),
          normalizeRational(30_000n, 1_001n),
          normalizeRational(60_000n, 1_001n),
        ),
        fc.constantFrom(44_100, 48_000, 96_000),
        (start, duration, fps, sampleRate) => {
          const range = millisecondsToLanguageRange({
            startMilliseconds: BigInt(start),
            endMillisecondsExclusive: BigInt(start + duration),
            sampleRate,
            fps,
          });
          expect(BigInt(range.endSampleExclusive)).toBeGreaterThan(BigInt(range.startSample));
          expect(BigInt(range.endFrameExclusive)).toBeGreaterThan(BigInt(range.startFrame));
          const repeated = millisecondsToLanguageRange({
            startMilliseconds: BigInt(start),
            endMillisecondsExclusive: BigInt(start + duration),
            sampleRate,
            fps,
          });
          expect(repeated).toEqual(range);
        },
      ),
      { numRuns: 500 },
    );
  });
});
