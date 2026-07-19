import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";

declare const masterFrameBrand: unique symbol;
export type MasterFrame = bigint & { readonly [masterFrameBrand]: true };

export interface FrameRange {
  readonly start: MasterFrame;
  readonly end: MasterFrame;
}

export const minimumMasterFrame = -(2n ** 255n) as MasterFrame;
export const maximumMasterFrame = (2n ** 255n - 1n) as MasterFrame;

export const masterFrame = (value: bigint, allowNegative = false): MasterFrame => {
  if (typeof value !== "bigint") {
    throw rangeError("timeline.frame.non-integer", "Master frame authority must be a bigint.");
  }
  if (value < minimumMasterFrame || value > maximumMasterFrame) {
    throw rangeError("timeline.frame.overflow", "Master frame exceeds signed 256-bit bounds.");
  }
  if (!allowNegative && value < 0n) {
    throw rangeError(
      "timeline.frame.negative",
      "Master frame cannot be negative in persisted timeline state.",
    );
  }
  return value as MasterFrame;
};

export const createFrameRange = (start: MasterFrame, end: MasterFrame, allowEmpty = false): FrameRange => {
  if (end < start || (!allowEmpty && end === start)) {
    throw rangeError(
      "timeline.range.invalid",
      allowEmpty ? "Range end precedes its start." : "Range must have positive half-open duration.",
    );
  }
  return { start, end };
};

export const frameRangeFromDuration = (start: MasterFrame, duration: MasterFrame): FrameRange => {
  if (duration <= 0n) throw rangeError("timeline.duration.invalid", "Duration must be positive.");
  return createFrameRange(start, addFrames(start, duration));
};

export const frameRangeDuration = (range: FrameRange): MasterFrame => masterFrame(range.end - range.start);

export const frameRangeContains = (range: FrameRange, frame: MasterFrame): boolean =>
  frame >= range.start && frame < range.end;

export const frameRangesOverlap = (left: FrameRange, right: FrameRange): boolean =>
  left.start < right.end && right.start < left.end;

export const intersectFrameRanges = (left: FrameRange, right: FrameRange): FrameRange | null => {
  const start = left.start > right.start ? left.start : right.start;
  const end = left.end < right.end ? left.end : right.end;
  return start < end ? { start, end } : null;
};

export const translateFrameRange = (range: FrameRange, delta: MasterFrame): FrameRange =>
  createFrameRange(addFrames(range.start, delta, true), addFrames(range.end, delta, true));

export const clampFrameToRange = (range: FrameRange, frame: MasterFrame): MasterFrame => {
  if (frame < range.start) return range.start;
  if (frame >= range.end) return masterFrame(range.end - 1n);
  return frame;
};

export const addFrames = (left: MasterFrame, right: MasterFrame, allowNegative = false): MasterFrame =>
  masterFrame(left + right, allowNegative);

export const subtractFrames = (left: MasterFrame, right: MasterFrame, allowNegative = false): MasterFrame =>
  masterFrame(left - right, allowNegative);

const rangeError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "timeline",
    code,
    correlationId: createCorrelationId(),
    stage: "master-frame-range",
    message,
    repairHint: "Use bounded integer master frames and a positive half-open [start, end) duration.",
  });
