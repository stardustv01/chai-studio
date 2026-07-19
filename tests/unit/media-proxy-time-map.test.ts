import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  buildSourceToProxyTimeMap,
  detectVariableFrameRateFromTimestamps,
  type SourceFrameTimestamp,
} from "../../packages/media/src/index.js";

describe("VFR detection and explicit source-to-proxy mapping", () => {
  it("distinguishes exact constant and variable timestamp cadence", () => {
    expect(detectVariableFrameRateFromTimestamps(frames(["0", "0.04", "0.08", "0.12"]))).toBe(false);
    expect(detectVariableFrameRateFromTimestamps(frames(["0", "0.04", "0.09", "0.13"]))).toBe(true);
  });

  it("maps every CFR proxy frame to the nearest exact source timestamp with earlier tie-breaking", () => {
    const map = buildSourceToProxyTimeMap({
      sourceContentHash: "c".repeat(64),
      proxyContentHash: "d".repeat(64),
      targetFrameRate: normalizeRational(25n, 1n),
      proxyFrameCount: "4",
      sourceFrames: frames(["0", "0.04", "0.09", "0.13"]),
    });
    expect(map.variableFrameRateSource).toBe(true);
    expect(map.mappings.map((entry) => entry.proxyTimestampSeconds)).toEqual([
      { numerator: "0", denominator: "1" },
      { numerator: "1", denominator: "25" },
      { numerator: "2", denominator: "25" },
      { numerator: "3", denominator: "25" },
    ]);
    expect(map.mappings.map((entry) => entry.sourceFrameIndex)).toEqual(["0", "1", "2", "3"]);
  });

  it("rejects missing timestamps, duplicate timestamps, invalid hashes, and unbounded maps", () => {
    expect(() =>
      buildSourceToProxyTimeMap({
        sourceContentHash: "bad",
        proxyContentHash: "d".repeat(64),
        targetFrameRate: normalizeRational(25n, 1n),
        proxyFrameCount: "1",
        sourceFrames: frames(["0"]),
      }),
    ).toThrow(/source SHA-256/);
    expect(() =>
      buildSourceToProxyTimeMap({
        sourceContentHash: "c".repeat(64),
        proxyContentHash: "d".repeat(64),
        targetFrameRate: normalizeRational(25n, 1n),
        proxyFrameCount: "1",
        sourceFrames: frames(["0", "0"]),
      }),
    ).toThrow(/timestamps must be unique/);
    expect(() =>
      buildSourceToProxyTimeMap({
        sourceContentHash: "c".repeat(64),
        proxyContentHash: "d".repeat(64),
        targetFrameRate: normalizeRational(25n, 1n),
        proxyFrameCount: "1",
        sourceFrames: [],
      }),
    ).toThrow(/requires source frame timestamps/);
  });
});

const frames = (timestamps: readonly string[]): readonly SourceFrameTimestamp[] =>
  timestamps.map((timestamp, index) => ({
    sourceFrameIndex: String(index),
    timestampSeconds: decimalRational(timestamp),
  }));

const decimalRational = (value: string) => {
  const [whole = "0", fraction = ""] = value.split(".");
  return normalizeRational(BigInt(`${whole}${fraction}`), 10n ** BigInt(fraction.length));
};
