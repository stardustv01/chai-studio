export interface PreviewRational {
  readonly numerator: string;
  readonly denominator: string;
}

export interface PreviewFrameRange {
  readonly startFrame: string;
  readonly endFrameExclusive: string;
}

export interface MasterClockSnapshot {
  readonly masterFrame: string;
  readonly presentationTimestamp: PreviewRational;
  readonly timelineFps: PreviewRational;
  readonly playRate: PreviewRational;
  readonly loopRange: PreviewFrameRange | null;
  readonly inOutRange: PreviewFrameRange | null;
}

export const normalizePreviewRational = (
  numeratorInput: bigint | string,
  denominatorInput: bigint | string,
): PreviewRational => {
  let numerator = parseSignedInteger(numeratorInput, "numerator");
  let denominator = parseSignedInteger(denominatorInput, "denominator");
  if (denominator === 0n) throw new Error("Preview rational denominator cannot be zero.");
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  if (numerator === 0n) return { numerator: "0", denominator: "1" };
  const divisor = greatestCommonDivisor(absolute(numerator), denominator);
  return {
    numerator: (numerator / divisor).toString(10),
    denominator: (denominator / divisor).toString(10),
  };
};

export const assertPositivePreviewRational = (value: PreviewRational, field: string): PreviewRational => {
  const normalized = normalizePreviewRational(value.numerator, value.denominator);
  if (BigInt(normalized.numerator) <= 0n) throw new Error(`Preview ${field} must be positive.`);
  if (normalized.numerator !== value.numerator || normalized.denominator !== value.denominator) {
    throw new Error(`Preview ${field} must be normalized.`);
  }
  return normalized;
};

export const presentationTimestampForFrame = (
  frameInput: bigint | string,
  timelineFps: PreviewRational,
): PreviewRational => {
  const frame = parseNonNegativeInteger(frameInput, "masterFrame");
  const fps = assertPositivePreviewRational(timelineFps, "timelineFps");
  return normalizePreviewRational(frame * BigInt(fps.denominator), fps.numerator);
};

export const framesForSecondStep = (seconds: number, timelineFps: PreviewRational): bigint => {
  if (!Number.isSafeInteger(seconds) || seconds === 0 || Math.abs(seconds) > 3_600) {
    throw new Error("Preview second-step value is outside bounded safe limits.");
  }
  const fps = assertPositivePreviewRational(timelineFps, "timelineFps");
  const magnitudeNumerator = BigInt(Math.abs(seconds)) * BigInt(fps.numerator);
  const denominator = BigInt(fps.denominator);
  const roundedToNearestFrame = (magnitudeNumerator * 2n + denominator) / (denominator * 2n);
  return seconds < 0 ? -roundedToNearestFrame : roundedToNearestFrame;
};

export const createPreviewFrameRange = (
  startFrameInput: bigint | string,
  endFrameExclusiveInput: bigint | string,
): PreviewFrameRange => {
  const startFrame = parseNonNegativeInteger(startFrameInput, "range.startFrame");
  const endFrameExclusive = parseNonNegativeInteger(endFrameExclusiveInput, "range.endFrameExclusive");
  if (endFrameExclusive <= startFrame) throw new Error("Preview range must be non-empty and half-open.");
  return { startFrame: startFrame.toString(10), endFrameExclusive: endFrameExclusive.toString(10) };
};

export class PreviewMasterClock {
  readonly #timelineFps: PreviewRational;
  readonly #durationFrames: bigint;
  #masterFrame: bigint;
  #playRate: PreviewRational = { numerator: "1", denominator: "1" };
  #loopRange: PreviewFrameRange | null = null;
  #inOutRange: PreviewFrameRange | null = null;

  constructor(input: {
    readonly timelineFps: PreviewRational;
    readonly durationFrames: string;
    readonly initialFrame?: string;
  }) {
    this.#timelineFps = assertPositivePreviewRational(input.timelineFps, "timelineFps");
    this.#durationFrames = parseNonNegativeInteger(input.durationFrames, "durationFrames");
    this.#masterFrame = parseNonNegativeInteger(input.initialFrame ?? "0", "initialFrame");
    this.#assertFrameInTimeline(this.#masterFrame);
  }

  snapshot(): MasterClockSnapshot {
    return {
      masterFrame: this.#masterFrame.toString(10),
      presentationTimestamp: presentationTimestampForFrame(this.#masterFrame, this.#timelineFps),
      timelineFps: this.#timelineFps,
      playRate: this.#playRate,
      loopRange: this.#loopRange,
      inOutRange: this.#inOutRange,
    };
  }

  seek(frameInput: bigint | string): MasterClockSnapshot {
    const frame = parseNonNegativeInteger(frameInput, "masterFrame");
    this.#assertFrameInTimeline(frame);
    this.#masterFrame = frame;
    return this.snapshot();
  }

  stepFrames(delta: number | bigint): MasterClockSnapshot {
    const parsedDelta = typeof delta === "bigint" ? delta : BigInt(assertSafeStep(delta));
    if (parsedDelta === 0n) throw new Error("Preview frame step cannot be zero.");
    return this.seek(this.#clamp(this.#masterFrame + parsedDelta));
  }

  stepSeconds(seconds: number): MasterClockSnapshot {
    return this.seek(this.#clamp(this.#masterFrame + framesForSecondStep(seconds, this.#timelineFps)));
  }

  advance(frameCount: bigint): MasterClockSnapshot {
    if (frameCount < 0n) throw new Error("Preview clock advance must be non-negative.");
    let target = this.#masterFrame + frameCount;
    if (this.#loopRange !== null) {
      const start = BigInt(this.#loopRange.startFrame);
      const end = BigInt(this.#loopRange.endFrameExclusive);
      if (target >= end) target = start + ((target - start) % (end - start));
    }
    return this.seek(this.#clamp(target));
  }

  setPlayRate(playRate: PreviewRational): MasterClockSnapshot {
    const normalized = normalizePreviewRational(playRate.numerator, playRate.denominator);
    const numerator = BigInt(normalized.numerator);
    if (numerator === 0n || absolute(numerator) > 4n * BigInt(normalized.denominator)) {
      throw new Error("Preview play rate must be non-zero and within -4x to +4x.");
    }
    this.#playRate = normalized;
    return this.snapshot();
  }

  setLoopRange(range: PreviewFrameRange | null): MasterClockSnapshot {
    this.#loopRange = range === null ? null : this.#assertRangeInTimeline(range, "loopRange");
    return this.snapshot();
  }

  setInOutRange(range: PreviewFrameRange | null): MasterClockSnapshot {
    this.#inOutRange = range === null ? null : this.#assertRangeInTimeline(range, "inOutRange");
    return this.snapshot();
  }

  #assertFrameInTimeline(frame: bigint): void {
    if (this.#durationFrames === 0n) {
      if (frame !== 0n) throw new Error("Preview frame is outside the empty timeline.");
      return;
    }
    if (frame >= this.#durationFrames) throw new Error("Preview frame is outside the timeline.");
  }

  #assertRangeInTimeline(range: PreviewFrameRange, field: string): PreviewFrameRange {
    const normalized = createPreviewFrameRange(range.startFrame, range.endFrameExclusive);
    if (BigInt(normalized.endFrameExclusive) > this.#durationFrames) {
      throw new Error(`Preview ${field} is outside the timeline.`);
    }
    return normalized;
  }

  #clamp(frame: bigint): bigint {
    if (frame < 0n || this.#durationFrames === 0n) return 0n;
    return frame >= this.#durationFrames ? this.#durationFrames - 1n : frame;
  }
}

const assertSafeStep = (value: number): number => {
  if (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > 1_000) {
    throw new Error("Preview frame-step delta is outside bounded safe limits.");
  }
  return value;
};

const parseSignedInteger = (value: bigint | string, field: string): bigint => {
  if (typeof value === "bigint") return value;
  if (!/^-?(?:0|[1-9][0-9]{0,77})$/.test(value) || value === "-0") {
    throw new Error(`Preview ${field} is not a canonical integer.`);
  }
  return BigInt(value);
};

const parseNonNegativeInteger = (value: bigint | string, field: string): bigint => {
  const parsed = parseSignedInteger(value, field);
  if (parsed < 0n) throw new Error(`Preview ${field} cannot be negative.`);
  return parsed;
};

const greatestCommonDivisor = (left: bigint, right: bigint): bigint => {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};

const absolute = (value: bigint): bigint => (value < 0n ? -value : value);
