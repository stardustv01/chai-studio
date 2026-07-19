import assert from "node:assert/strict";
import test from "node:test";
import { AudioTransportModel, nativeEngineAudioPolicy } from "../src/audio-transport.mjs";

const transport = new AudioTransportModel({ fps: { num: 30000, den: 1001 }, sampleRate: 48000 });

test("maps NTSC frame ranges to exact half-open sample coverage", () => {
  assert.deepEqual(transport.sampleRangeForFrames(0, 300), { startSample: 0n, endSampleExclusive: 480480n });
  assert.deepEqual(transport.sampleRangeForFrames(120, 180), { startSample: 192192n, endSampleExclusive: 288288n });
});

test("ten-minute audio position has zero integer-mapping drift", () => {
  const tenMinuteFrame = 17982n;
  const expected = transport.sampleBoundaryForFrame(tenMinuteFrame, "floor");
  const report = transport.driftAtFrame(tenMinuteFrame, expected);
  assert.equal(report.deltaSamples, 0n);
  assert.equal(report.hardResyncRequired, false);
  assert.equal(report.thresholdSamples, 801n);
});

test("drift beyond half a master frame requires hard resync", () => {
  const expected = transport.sampleBoundaryForFrame(1000n, "floor");
  assert.equal(transport.driftAtFrame(1000n, expected + 801n).hardResyncRequired, false);
  assert.equal(transport.driftAtFrame(1000n, expected + 802n).hardResyncRequired, true);
});

test("seek barrier presents only after engines and central audio are ready", async () => {
  const calls = [];
  const result = await transport.seekBarrier({
    sessionId: "seek-1",
    frame: 30n,
    prepareEngines: async (frame) => (calls.push(["engines", frame]), { remotion: "ready", hyperframes: "ready" }),
    prepareAudio: async (sample) => (calls.push(["audio", sample]), { sample, status: "ready" }),
  });
  assert.equal(result.presentedAtomically, true);
  assert.deepEqual(calls, [["engines", 30n], ["audio", 48048n]]);
  assert.equal(nativeEngineAudioPolicy.programMix, "suppressed");
});
