import type { PreviewRational } from "../master-clock.js";
import type { SharedSourceSample, SharedVideoClip } from "./contracts.js";

interface RationalParts {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export const sampleSharedVideoSource = (
  clip: SharedVideoClip,
  timelineFrameInput: string,
  preferProxy = false,
): SharedSourceSample => {
  const timelineFrame = parseInteger(timelineFrameInput, "timelineFrame");
  const timelineStart = parseInteger(clip.timelineRange.startFrame, "timelineRange.startFrame");
  const timelineEnd = parseInteger(clip.timelineRange.endFrameExclusive, "timelineRange.endFrameExclusive");
  if (timelineFrame < timelineStart || timelineFrame >= timelineEnd) {
    throw new Error(`Timeline frame ${timelineFrameInput} is outside shared clip ${clip.clipId}.`);
  }
  const sourceStart = parseInteger(clip.sourceStartFrame, "sourceStartFrame");
  const timelineFps = positiveRational(clip.timelineFps, "timelineFps");
  const sourceFps = positiveRational(clip.sourceFps, "sourceFps");
  const speed = nonZeroRational(clip.speed, "speed");
  const offset = timelineFrame - timelineStart;
  const numerator =
    sourceStart * timelineFps.numerator * sourceFps.denominator * speed.denominator +
    offset * sourceFps.numerator * timelineFps.denominator * speed.numerator;
  const denominator = timelineFps.numerator * sourceFps.denominator * speed.denominator;
  const exact = normalize(numerator, denominator);
  const originalSourceFrame = floorDivide(exact.numerator, exact.denominator);
  const useProxy = preferProxy && clip.proxy !== null;
  if (!useProxy) {
    return {
      timelineFrame: timelineFrame.toString(),
      exactSourceFrame: serialized(exact),
      originalSourceFrame: originalSourceFrame.toString(),
      selectedAssetId: clip.assetId,
      selectedContentHash: clip.contentHash,
      selectedSourceFrame: originalSourceFrame.toString(),
      usedProxy: false,
    };
  }
  const proxy = clip.proxy;
  const scale = nonZeroRational(proxy.sourceToProxyScale, "proxy.sourceToProxyScale");
  const proxyOffset = rational(proxy.sourceToProxyOffset, "proxy.sourceToProxyOffset");
  const mapped = add(multiply({ numerator: originalSourceFrame, denominator: 1n }, scale), proxyOffset);
  return {
    timelineFrame: timelineFrame.toString(),
    exactSourceFrame: serialized(exact),
    originalSourceFrame: originalSourceFrame.toString(),
    selectedAssetId: proxy.assetId,
    selectedContentHash: proxy.contentHash,
    selectedSourceFrame: floorDivide(mapped.numerator, mapped.denominator).toString(),
    usedProxy: true,
  };
};

const rational = (value: PreviewRational, field: string): RationalParts => {
  const numerator = parseInteger(value.numerator, `${field}.numerator`);
  const denominator = parseInteger(value.denominator, `${field}.denominator`);
  if (denominator === 0n) throw new Error(`${field} denominator cannot be zero.`);
  return normalize(numerator, denominator);
};

const positiveRational = (value: PreviewRational, field: string): RationalParts => {
  const parsed = rational(value, field);
  if (parsed.numerator <= 0n) throw new Error(`${field} must be positive.`);
  return parsed;
};

const nonZeroRational = (value: PreviewRational, field: string): RationalParts => {
  const parsed = rational(value, field);
  if (parsed.numerator === 0n) throw new Error(`${field} cannot be zero.`);
  return parsed;
};

const multiply = (left: RationalParts, right: RationalParts): RationalParts =>
  normalize(left.numerator * right.numerator, left.denominator * right.denominator);

const add = (left: RationalParts, right: RationalParts): RationalParts =>
  normalize(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );

const normalize = (numeratorInput: bigint, denominatorInput: bigint): RationalParts => {
  let numerator = numeratorInput;
  let denominator = denominatorInput;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
};

const gcd = (leftInput: bigint, rightInput: bigint): bigint => {
  let left = leftInput < 0n ? -leftInput : leftInput;
  let right = rightInput < 0n ? -rightInput : rightInput;
  while (right !== 0n) [left, right] = [right, left % right];
  return left === 0n ? 1n : left;
};

const floorDivide = (numerator: bigint, denominator: bigint): bigint => {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder !== 0n && numerator < 0n ? quotient - 1n : quotient;
};

const parseInteger = (value: string, field: string): bigint => {
  if (!/^-?(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${field} must be a canonical integer string.`);
  return BigInt(value);
};

const serialized = (value: RationalParts): PreviewRational => ({
  numerator: value.numerator.toString(),
  denominator: value.denominator.toString(),
});
