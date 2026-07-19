import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  deserializeRational,
  normalizeRational,
  parseBigIntString,
} from "../../packages/schema/src/index.js";

describe("rational algebra properties", () => {
  it("is canonical, idempotent, and JSON round-trip stable", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }),
        fc.bigInt({ min: -(2n ** 31n), max: 2n ** 31n - 1n }).filter((value) => value !== 0n),
        (numerator, denominator) => {
          const normalized = normalizeRational(numerator, denominator);
          expect(parseBigIntString(normalized.denominator)).toBeGreaterThan(0n);
          expect(normalizeRational(normalized.numerator, normalized.denominator)).toEqual(normalized);
          expect(deserializeRational(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
