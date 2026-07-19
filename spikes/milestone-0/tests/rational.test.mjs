import assert from "node:assert/strict";
import test from "node:test";
import { frameRangeToSampleRange, masterFrameToSourceFrame, rational, serializeRational } from "../src/rational.mjs";

test("normalizes NTSC rational values", () => {
  assert.deepEqual(serializeRational(rational(60000n, 2002n)), { numerator: "30000", denominator: "1001" });
  assert.deepEqual(serializeRational(rational(-24000n, -1001n)), { numerator: "24000", denominator: "1001" });
});

test("maps master frames deterministically across rational rates", () => {
  const input = {
    masterFrame: 30000n,
    timelineFps: rational(30000n, 1001n),
    sourceFps: rational(24000n, 1001n),
    speedRatio: rational(1n, 1n),
  };
  assert.equal(masterFrameToSourceFrame(input), 24000n);
  assert.equal(masterFrameToSourceFrame(input), 24000n);
});

test("maps half-open frame ranges to floor-start and ceiling-end samples", () => {
  assert.deepEqual(frameRangeToSampleRange({
    startFrame: 1n,
    endFrame: 2n,
    timelineFps: rational(30000n, 1001n),
    sampleRate: 48000n,
  }), { startSample: 1601n, endSample: 3204n });
});
