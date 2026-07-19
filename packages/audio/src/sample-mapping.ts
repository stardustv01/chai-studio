import { parseBigIntString, type NormalizedRational } from "@chai-studio/schema/rational";

export interface AudioSampleRange {
  readonly startSample: bigint;
  readonly endSampleExclusive: bigint;
}

export const floorDivide = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error("Audio division denominator must be positive.");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder < 0n ? quotient - 1n : quotient;
};

export const ceilDivide = (numerator: bigint, denominator: bigint): bigint =>
  -floorDivide(-numerator, denominator);

export const sampleBoundaryForFrame = (
  frame: bigint,
  fps: NormalizedRational,
  sampleRate: number,
  rounding: "floor" | "ceil",
): bigint => {
  if (frame < 0n) throw new Error("Audio frame must be non-negative.");
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 384_000) {
    throw new Error("Audio sample rate is outside the supported range.");
  }
  const numerator = frame * BigInt(sampleRate) * parseBigIntString(fps.denominator);
  const denominator = parseBigIntString(fps.numerator);
  if (denominator <= 0n) throw new Error("Timeline FPS must be positive.");
  return rounding === "floor" ? floorDivide(numerator, denominator) : ceilDivide(numerator, denominator);
};

export const sampleRangeForFrames = (
  startFrame: bigint,
  endFrameExclusive: bigint,
  fps: NormalizedRational,
  sampleRate: number,
): AudioSampleRange => {
  if (endFrameExclusive < startFrame) {
    throw new Error("Audio frame range end must be at or after its start.");
  }
  return {
    startSample: sampleBoundaryForFrame(startFrame, fps, sampleRate, "floor"),
    endSampleExclusive: sampleBoundaryForFrame(endFrameExclusive, fps, sampleRate, "ceil"),
  };
};

export const driftThresholdSamples = (
  fps: NormalizedRational,
  sampleRate: number,
  thresholdFrames: NormalizedRational,
): bigint =>
  ceilDivide(
    BigInt(sampleRate) * parseBigIntString(fps.denominator) * parseBigIntString(thresholdFrames.numerator),
    parseBigIntString(fps.numerator) * parseBigIntString(thresholdFrames.denominator),
  );

export const audioDriftAtFrame = (input: {
  readonly frame: bigint;
  readonly observedSample: bigint;
  readonly fps: NormalizedRational;
  readonly sampleRate: number;
  readonly thresholdFrames: NormalizedRational;
}) => {
  const expectedSample = sampleBoundaryForFrame(input.frame, input.fps, input.sampleRate, "floor");
  const deltaSamples = input.observedSample - expectedSample;
  const thresholdSamples = driftThresholdSamples(input.fps, input.sampleRate, input.thresholdFrames);
  return {
    expectedSample,
    observedSample: input.observedSample,
    deltaSamples,
    thresholdSamples,
    hardResyncRequired: deltaSamples < -thresholdSamples || deltaSamples > thresholdSamples,
  } as const;
};
