import { describe, expect, it } from "vitest";
import {
  assertPositiveRational,
  compareRationals,
  deserializeRational,
  multiplyRationals,
  normalizeRational,
  parseBigIntString,
  serializeBigInt,
} from "../../packages/schema/src/index.js";

describe("normalized rational persistence", () => {
  it.each([
    [24_000n, 1_001n, "24000", "1001"],
    [30_000n, 1_001n, "30000", "1001"],
    [60_000n, 1_001n, "60000", "1001"],
    [200n, 100n, "2", "1"],
    [-2n, -4n, "1", "2"],
    [0n, 99n, "0", "1"],
  ])("normalizes %s/%s", (numerator, denominator, expectedNumerator, expectedDenominator) => {
    expect(normalizeRational(numerator, denominator)).toEqual({
      numerator: expectedNumerator,
      denominator: expectedDenominator,
    });
  });

  it("round-trips canonical JSON without numeric precision loss", () => {
    const value = normalizeRational(9_007_199_254_740_993n, 1_001n);
    const restored = deserializeRational(JSON.parse(JSON.stringify(value)));
    expect(restored).toEqual(value);
    expect(parseBigIntString(serializeBigInt(9_007_199_254_740_993n))).toBe(9_007_199_254_740_993n);
  });

  it("rejects invalid, unsafe, non-canonical, and non-positive persisted rates", () => {
    expect(() => deserializeRational({ numerator: 30_000, denominator: 1_001 })).toThrow();
    expect(() => deserializeRational({ numerator: "2", denominator: "4" })).toThrow(/lowest terms/);
    expect(() => deserializeRational({ numerator: "1", denominator: "-2" })).toThrow(/positive denominator/);
    expect(() => normalizeRational(1n, 0n)).toThrow(/Invalid persisted rational/);
    expect(() => parseBigIntString("01")).toThrow(/canonical base-10/);
    expect(() => assertPositiveRational(normalizeRational(0n, 1n), "fps")).toThrow(/greater than zero/);
  });

  it("multiplies and compares without floating-point conversion", () => {
    expect(multiplyRationals(normalizeRational(30_000n, 1_001n), normalizeRational(1n, 2n))).toEqual({
      numerator: "15000",
      denominator: "1001",
    });
    expect(compareRationals(normalizeRational(24_000n, 1_001n), normalizeRational(24n, 1n))).toBe(-1);
  });
});
