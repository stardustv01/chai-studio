import { ceilDivide, floorDivide, rational } from "./rational.mjs";

const normalize = (value) => rational(BigInt(value.numerator ?? value.num), BigInt(value.denominator ?? value.den));

export class AudioTransportModel {
  constructor({ fps, sampleRate, driftThresholdFrames = { num: 1, den: 2 } }) {
    this.fps = normalize(fps);
    this.sampleRate = BigInt(sampleRate);
    this.driftThresholdFrames = normalize(driftThresholdFrames);
  }

  sampleBoundaryForFrame(frame, rounding = "floor") {
    const numerator = BigInt(frame) * this.sampleRate * this.fps.denominator;
    const denominator = this.fps.numerator;
    return rounding === "ceil" ? ceilDivide(numerator, denominator) : floorDivide(numerator, denominator);
  }

  sampleRangeForFrames(startFrame, endFrameExclusive) {
    if (BigInt(endFrameExclusive) < BigInt(startFrame)) throw new Error("endFrameExclusive must be at or after startFrame");
    return {
      startSample: this.sampleBoundaryForFrame(startFrame, "floor"),
      endSampleExclusive: this.sampleBoundaryForFrame(endFrameExclusive, "ceil"),
    };
  }

  driftAtFrame(frame, actualSample) {
    const expectedSample = this.sampleBoundaryForFrame(frame, "floor");
    const deltaSamples = BigInt(actualSample) - expectedSample;
    const thresholdSamples = ceilDivide(
      this.sampleRate * this.fps.denominator * this.driftThresholdFrames.numerator,
      this.fps.numerator * this.driftThresholdFrames.denominator,
    );
    return {
      expectedSample,
      actualSample: BigInt(actualSample),
      deltaSamples,
      thresholdSamples,
      hardResyncRequired: deltaSamples < -thresholdSamples || deltaSamples > thresholdSamples,
    };
  }

  async seekBarrier({ sessionId, frame, prepareEngines, prepareAudio }) {
    const [engines, audio] = await Promise.all([prepareEngines(frame), prepareAudio(this.sampleBoundaryForFrame(frame, "floor"))]);
    return { sessionId, frame: BigInt(frame), engines, audio, presentedAtomically: true };
  }
}

export const nativeEngineAudioPolicy = Object.freeze({ programMix: "suppressed", sourceInspection: "explicit-only" });
