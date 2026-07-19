import {
  deserializeRational,
  normalizeRational,
  parseBigIntString,
  type NormalizedRational,
} from "@chai-studio/schema";

export interface SourceFrameTimestamp {
  readonly sourceFrameIndex: string;
  readonly timestampSeconds: NormalizedRational;
}

export interface ProxyFrameTimeMapping {
  readonly proxyFrameIndex: string;
  readonly proxyTimestampSeconds: NormalizedRational;
  readonly sourceFrameIndex: string;
  readonly sourceTimestampSeconds: NormalizedRational;
}

export interface SourceToProxyTimeMapV1 {
  readonly schemaVersion: "1.0.0";
  readonly sourceContentHash: string;
  readonly proxyContentHash: string;
  readonly targetFrameRate: NormalizedRational;
  readonly proxyFrameCount: string;
  readonly variableFrameRateSource: boolean;
  readonly mappings: readonly ProxyFrameTimeMapping[];
}

export interface BuildSourceToProxyTimeMapInput {
  readonly sourceContentHash: string;
  readonly proxyContentHash: string;
  readonly targetFrameRate: NormalizedRational;
  readonly proxyFrameCount: string;
  readonly sourceFrames: readonly SourceFrameTimestamp[];
}

export const detectVariableFrameRateFromTimestamps = (frames: readonly SourceFrameTimestamp[]): boolean => {
  const ordered = normalizeSourceFrames(frames);
  if (ordered.length < 3) return false;
  const first = ordered[0];
  const second = ordered[1];
  if (first === undefined || second === undefined) return false;
  const expectedDelta = subtractRationals(second.timestampSeconds, first.timestampSeconds);
  for (let index = 2; index < ordered.length; index += 1) {
    const prior = ordered[index - 1];
    const current = ordered[index];
    if (prior === undefined || current === undefined) continue;
    if (
      compareExactRationals(
        subtractRationals(current.timestampSeconds, prior.timestampSeconds),
        expectedDelta,
      ) !== 0
    ) {
      return true;
    }
  }
  return false;
};

export const buildSourceToProxyTimeMap = (input: BuildSourceToProxyTimeMapInput): SourceToProxyTimeMapV1 => {
  assertHash(input.sourceContentHash, "source");
  assertHash(input.proxyContentHash, "proxy");
  const targetRate = rationalParts(input.targetFrameRate);
  if (targetRate.numerator <= 0n) throw new Error("Target proxy frame rate must be positive.");
  if (!/^(?:0|[1-9][0-9]*)$/.test(input.proxyFrameCount)) {
    throw new Error("Proxy frame count must be a non-negative integer string.");
  }
  const proxyFrameCount = BigInt(input.proxyFrameCount);
  if (proxyFrameCount > 10_000_000n) throw new Error("Proxy time map exceeds the bounded frame count.");
  const sourceFrames = normalizeSourceFrames(input.sourceFrames);
  if (proxyFrameCount > 0n && sourceFrames.length === 0) {
    throw new Error("A non-empty proxy requires source frame timestamps.");
  }
  const mappings: ProxyFrameTimeMapping[] = [];
  let sourceCursor = 0;
  for (let proxyFrame = 0n; proxyFrame < proxyFrameCount; proxyFrame += 1n) {
    const proxyTimestampSeconds = normalizeRational(
      proxyFrame * targetRate.denominator,
      targetRate.numerator,
    );
    while (
      sourceCursor + 1 < sourceFrames.length &&
      distanceCompare(
        sourceFrames[sourceCursor]?.timestampSeconds,
        sourceFrames[sourceCursor + 1]?.timestampSeconds,
        proxyTimestampSeconds,
      ) > 0
    ) {
      sourceCursor += 1;
    }
    const source = sourceFrames[sourceCursor];
    if (source === undefined) throw new Error("Source time-map cursor escaped its bounded frame list.");
    mappings.push({
      proxyFrameIndex: String(proxyFrame),
      proxyTimestampSeconds,
      sourceFrameIndex: source.sourceFrameIndex,
      sourceTimestampSeconds: source.timestampSeconds,
    });
  }
  return {
    schemaVersion: "1.0.0",
    sourceContentHash: input.sourceContentHash,
    proxyContentHash: input.proxyContentHash,
    targetFrameRate: input.targetFrameRate,
    proxyFrameCount: input.proxyFrameCount,
    variableFrameRateSource: detectVariableFrameRateFromTimestamps(sourceFrames),
    mappings,
  };
};

const normalizeSourceFrames = (frames: readonly SourceFrameTimestamp[]): readonly SourceFrameTimestamp[] => {
  const ordered = [...frames].sort(
    (left, right) =>
      compareExactRationals(left.timestampSeconds, right.timestampSeconds) ||
      compareIntegerStrings(left.sourceFrameIndex, right.sourceFrameIndex),
  );
  for (const [index, frame] of ordered.entries()) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(frame.sourceFrameIndex)) {
      throw new Error(`Invalid source frame index: ${frame.sourceFrameIndex}.`);
    }
    if (rationalParts(frame.timestampSeconds).numerator < 0n) {
      throw new Error("Source frame timestamps must be non-negative.");
    }
    const prior = ordered[index - 1];
    if (prior !== undefined && compareExactRationals(prior.timestampSeconds, frame.timestampSeconds) === 0) {
      throw new Error("Source frame timestamps must be unique.");
    }
  }
  return ordered;
};

const distanceCompare = (
  left: NormalizedRational | undefined,
  right: NormalizedRational | undefined,
  target: NormalizedRational,
): number => {
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  const leftDistance = absoluteRational(subtractRationals(left, target));
  const rightDistance = absoluteRational(subtractRationals(right, target));
  return compareExactRationals(leftDistance, rightDistance);
};

const subtractRationals = (left: NormalizedRational, right: NormalizedRational): NormalizedRational => {
  const a = rationalParts(left);
  const b = rationalParts(right);
  return normalizeRational(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
};

const absoluteRational = (value: NormalizedRational): NormalizedRational => {
  const parts = rationalParts(value);
  return normalizeRational(parts.numerator < 0n ? 0n - parts.numerator : parts.numerator, parts.denominator);
};

const compareExactRationals = (left: NormalizedRational, right: NormalizedRational): number => {
  const a = rationalParts(left);
  const b = rationalParts(right);
  const leftValue = a.numerator * b.denominator;
  const rightValue = b.numerator * a.denominator;
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};

const rationalParts = (value: NormalizedRational): Readonly<{ numerator: bigint; denominator: bigint }> => {
  const rational = deserializeRational(value);
  return {
    numerator: parseBigIntString(rational.numerator),
    denominator: parseBigIntString(rational.denominator),
  };
};

const compareIntegerStrings = (left: string, right: string): number => {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

const assertHash = (value: string, label: string): void => {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid ${label} SHA-256 hash.`);
};
