const assertBigInt = (value, label) => {
  if (typeof value !== "bigint") throw new TypeError(`${label} must be a bigint`);
};

export const gcd = (left, right) => {
  assertBigInt(left, "left");
  assertBigInt(right, "right");
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};

export const rational = (numerator, denominator) => {
  assertBigInt(numerator, "numerator");
  assertBigInt(denominator, "denominator");
  if (denominator === 0n) throw new RangeError("denominator must not be zero");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return Object.freeze({
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  });
};

export const multiply = (left, right) =>
  rational(left.numerator * right.numerator, left.denominator * right.denominator);

export const floorDivide = (numerator, denominator) => {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder < 0n ? quotient - 1n : quotient;
};

export const ceilDivide = (numerator, denominator) =>
  -floorDivide(-numerator, denominator);

export const masterFrameToSourceFrame = ({ masterFrame, timelineFps, sourceFps, speedRatio }) => {
  assertBigInt(masterFrame, "masterFrame");
  const mapping = multiply(multiply(sourceFps, speedRatio), rational(timelineFps.denominator, timelineFps.numerator));
  return floorDivide(masterFrame * mapping.numerator, mapping.denominator);
};

export const frameRangeToSampleRange = ({ startFrame, endFrame, timelineFps, sampleRate }) => {
  assertBigInt(startFrame, "startFrame");
  assertBigInt(endFrame, "endFrame");
  assertBigInt(sampleRate, "sampleRate");
  if (startFrame < 0n || endFrame < startFrame) throw new RangeError("invalid half-open frame range");
  const numeratorPerFrame = sampleRate * timelineFps.denominator;
  return Object.freeze({
    startSample: floorDivide(startFrame * numeratorPerFrame, timelineFps.numerator),
    endSample: ceilDivide(endFrame * numeratorPerFrame, timelineFps.numerator),
  });
};

export const serializeRational = (value) => ({
  numerator: value.numerator.toString(),
  denominator: value.denominator.toString(),
});
