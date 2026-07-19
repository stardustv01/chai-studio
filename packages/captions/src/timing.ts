import type { BigIntString, NormalizedRational } from "@chai-studio/schema";

export interface TimedLanguageRange {
  readonly startSample: BigIntString;
  readonly endSampleExclusive: BigIntString;
  readonly startFrame: BigIntString;
  readonly endFrameExclusive: BigIntString;
}

export const millisecondsToLanguageRange = (input: {
  readonly startMilliseconds: bigint;
  readonly endMillisecondsExclusive: bigint;
  readonly sampleRate: number;
  readonly fps: NormalizedRational;
}): TimedLanguageRange => {
  if (input.startMilliseconds < 0n || input.endMillisecondsExclusive <= input.startMilliseconds) {
    throw new Error("Timed language range must be non-empty and non-negative.");
  }
  const startSample = floorDiv(input.startMilliseconds * BigInt(input.sampleRate), 1_000n);
  const endSampleExclusive = ceilDiv(input.endMillisecondsExclusive * BigInt(input.sampleRate), 1_000n);
  const frameDenominator = BigInt(input.sampleRate) * BigInt(input.fps.denominator);
  const startFrame = floorDiv(startSample * BigInt(input.fps.numerator), frameDenominator);
  const mappedEnd = ceilDiv(endSampleExclusive * BigInt(input.fps.numerator), frameDenominator);
  const endFrameExclusive = mappedEnd > startFrame ? mappedEnd : startFrame + 1n;
  return {
    startSample: startSample.toString(10) as BigIntString,
    endSampleExclusive: endSampleExclusive.toString(10) as BigIntString,
    startFrame: startFrame.toString(10) as BigIntString,
    endFrameExclusive: endFrameExclusive.toString(10) as BigIntString,
  };
};

export const distributeWordSampleRanges = (
  startSampleInput: BigIntString,
  endSampleInput: BigIntString,
  wordCount: number,
): readonly Readonly<{ startSample: BigIntString; endSampleExclusive: BigIntString }>[] => {
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) throw new Error("Word count must be positive.");
  const start = BigInt(startSampleInput);
  const end = BigInt(endSampleInput);
  if (end <= start) throw new Error("Cannot distribute words across an empty sample range.");
  const duration = end - start;
  return Array.from({ length: wordCount }, (_, index) => {
    const wordStart = start + floorDiv(duration * BigInt(index), BigInt(wordCount));
    const wordEnd = start + ceilDiv(duration * BigInt(index + 1), BigInt(wordCount));
    return {
      startSample: wordStart.toString(10) as BigIntString,
      endSampleExclusive: (wordEnd > wordStart ? wordEnd : wordStart + 1n).toString(10) as BigIntString,
    };
  });
};

export const sampleRangeToFrameRange = (input: {
  readonly startSample: BigIntString;
  readonly endSampleExclusive: BigIntString;
  readonly sampleRate: number;
  readonly fps: NormalizedRational;
}): Readonly<{ startFrame: BigIntString; endFrameExclusive: BigIntString }> => {
  const startSample = BigInt(input.startSample);
  const endSample = BigInt(input.endSampleExclusive);
  const denominator = BigInt(input.sampleRate) * BigInt(input.fps.denominator);
  const startFrame = floorDiv(startSample * BigInt(input.fps.numerator), denominator);
  const mappedEnd = ceilDiv(endSample * BigInt(input.fps.numerator), denominator);
  return {
    startFrame: startFrame.toString(10) as BigIntString,
    endFrameExclusive: (mappedEnd > startFrame ? mappedEnd : startFrame + 1n).toString(10) as BigIntString,
  };
};

const floorDiv = (numerator: bigint, denominator: bigint): bigint => numerator / denominator;
const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator - 1n) / denominator;
