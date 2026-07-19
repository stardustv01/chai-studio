import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import {
  deserializeRational,
  normalizeRational,
  parseBigIntString,
  type NormalizedRational,
} from "@chai-studio/schema/rational";
import { masterFrame, type FrameRange, type MasterFrame } from "./range.js";

export type FrameRoundingPolicy = "floor" | "ceil" | "nearest";

export interface ExactFrameTransform {
  readonly inputOrigin: MasterFrame;
  readonly outputOrigin: MasterFrame;
  readonly scale: NormalizedRational;
}

export interface TimelineSourceTransformInput {
  readonly timelineOrigin: MasterFrame;
  readonly sourceOrigin: MasterFrame;
  readonly timelineRate: NormalizedRational;
  readonly sourceRate: NormalizedRational;
  readonly speed: NormalizedRational;
}

export interface TimecodeDisplay {
  readonly text: string;
  readonly dropFrame: boolean;
  readonly nominalFps: 24 | 25 | 30 | 50 | 60;
}

export const createTimelineSourceTransform = (input: TimelineSourceTransformInput): ExactFrameTransform => {
  const timelineRate = rationalParts(input.timelineRate);
  const sourceRate = rationalParts(input.sourceRate);
  const speed = rationalParts(input.speed);
  if (timelineRate.numerator <= 0n || sourceRate.numerator <= 0n || speed.numerator <= 0n) {
    throw transformError("timeline.transform.rate-invalid", "Rates and speed must be positive.");
  }
  return {
    inputOrigin: input.timelineOrigin,
    outputOrigin: input.sourceOrigin,
    scale: normalizeRational(
      sourceRate.numerator * timelineRate.denominator * speed.numerator,
      sourceRate.denominator * timelineRate.numerator * speed.denominator,
    ),
  };
};

export const mapFrameExact = (
  transform: ExactFrameTransform,
  input: MasterFrame,
  policy: FrameRoundingPolicy,
): MasterFrame => {
  const scale = rationalParts(transform.scale);
  const delta = input - transform.inputOrigin;
  const mappedDelta = divideWithPolicy(delta * scale.numerator, scale.denominator, policy);
  return masterFrame(transform.outputOrigin + mappedDelta, true);
};

export const mapRangeExact = (transform: ExactFrameTransform, range: FrameRange): FrameRange => ({
  start: mapFrameExact(transform, range.start, "floor"),
  end: mapFrameExact(transform, range.end, "ceil"),
});

export const invertFrameTransform = (transform: ExactFrameTransform): ExactFrameTransform => {
  const scale = rationalParts(transform.scale);
  return {
    inputOrigin: transform.outputOrigin,
    outputOrigin: transform.inputOrigin,
    scale: normalizeRational(scale.denominator, scale.numerator),
  };
};

export const composeFrameTransforms = (
  first: ExactFrameTransform,
  second: ExactFrameTransform,
): ExactFrameTransform => {
  if (first.outputOrigin !== second.inputOrigin) {
    throw transformError(
      "timeline.transform.origin-mismatch",
      "Nested transform origins must join at the same exact frame.",
    );
  }
  const firstScale = rationalParts(first.scale);
  const secondScale = rationalParts(second.scale);
  return {
    inputOrigin: first.inputOrigin,
    outputOrigin: second.outputOrigin,
    scale: normalizeRational(
      firstScale.numerator * secondScale.numerator,
      firstScale.denominator * secondScale.denominator,
    ),
  };
};

export const formatTimecode = (
  frame: MasterFrame,
  rate: NormalizedRational,
  dropFrame: boolean,
): TimecodeDisplay => {
  if (frame < 0n) {
    throw transformError("timeline.timecode.negative", "Display timecode frame cannot be negative.");
  }
  const parts = rationalParts(rate);
  const nominal = nominalRate(parts.numerator, parts.denominator);
  let displayFrame: bigint = frame;
  if (dropFrame) {
    if (!(
      (parts.numerator === 30_000n && parts.denominator === 1_001n) ||
      (parts.numerator === 60_000n && parts.denominator === 1_001n)
    )) {
      throw transformError(
        "timeline.timecode.drop-frame-unsupported",
        "Drop-frame display is supported only for 30000/1001 and 60000/1001.",
      );
    }
    const dropCount = nominal === 30 ? 2n : 4n;
    const nominalBigInt = BigInt(nominal);
    const framesPerTenMinutes = nominalBigInt * 600n - dropCount * 9n;
    const framesPerMinute = nominalBigInt * 60n - dropCount;
    const framesPer24Hours = framesPerTenMinutes * 6n * 24n;
    const wrapped = frame % framesPer24Hours;
    const tenMinuteChunks = wrapped / framesPerTenMinutes;
    const remainder = wrapped % framesPerTenMinutes;
    displayFrame =
      wrapped +
      dropCount * 9n * tenMinuteChunks +
      (remainder >= dropCount ? dropCount * ((remainder - dropCount) / framesPerMinute) : 0n);
  }
  const nominalBigInt = BigInt(nominal);
  const frames = displayFrame % nominalBigInt;
  const totalSeconds = displayFrame / nominalBigInt;
  const seconds = totalSeconds % 60n;
  const totalMinutes = totalSeconds / 60n;
  const minutes = totalMinutes % 60n;
  const hours = (totalMinutes / 60n) % 24n;
  const separator = dropFrame ? ";" : ":";
  return {
    text: `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}${separator}${pad2(frames)}`,
    dropFrame,
    nominalFps: nominal,
  };
};

const rationalParts = (value: NormalizedRational): Readonly<{ numerator: bigint; denominator: bigint }> => {
  const normalized = deserializeRational(value);
  return {
    numerator: parseBigIntString(normalized.numerator),
    denominator: parseBigIntString(normalized.denominator),
  };
};

const divideWithPolicy = (numerator: bigint, denominator: bigint, policy: FrameRoundingPolicy): bigint => {
  if (denominator <= 0n)
    throw transformError("timeline.transform.denominator", "Denominator must be positive.");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  if (policy === "floor") return numerator < 0n ? quotient - 1n : quotient;
  if (policy === "ceil") return numerator > 0n ? quotient + 1n : quotient;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  if (absoluteRemainder * 2n < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
};

const nominalRate = (numerator: bigint, denominator: bigint): 24 | 25 | 30 | 50 | 60 => {
  const rounded = divideWithPolicy(numerator, denominator, "nearest");
  if (rounded === 24n || rounded === 25n || rounded === 30n || rounded === 50n || rounded === 60n) {
    return Number(rounded) as 24 | 25 | 30 | 50 | 60;
  }
  throw transformError(
    "timeline.timecode.rate-unsupported",
    "Timecode display supports nominal 24, 25, 30, 50, or 60 fps.",
  );
};

const pad2 = (value: bigint): string => value.toString().padStart(2, "0");

const transformError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "timeline",
    code,
    correlationId: createCorrelationId(),
    stage: "exact-frame-transform",
    message,
    repairHint: "Use normalized positive rational rates and select an explicit boundary rounding policy.",
  });
