import type { InterpolationKind, KeyframeSnapshot, TimelinePropertyValue } from "./model.js";
import { masterFrame, type MasterFrame } from "./range.js";

export type CurvePreset = Extract<
  InterpolationKind,
  "hold" | "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out" | "bezier"
>;

export interface CurveSample {
  readonly frame: MasterFrame;
  readonly progress: number;
  readonly value: number | readonly number[];
  readonly speed: number | readonly number[];
}

export const curveTangentsForPreset = (
  preset: Exclude<CurvePreset, "hold" | "linear" | "bezier">,
): Readonly<{ out: readonly [number, number]; in: readonly [number, number] }> => {
  switch (preset) {
    case "ease":
      return { out: [0.25, 0.1], in: [0.25, 1] };
    case "ease-in":
      return { out: [0.42, 0], in: [1, 1] };
    case "ease-out":
      return { out: [0, 0], in: [0.58, 1] };
    case "ease-in-out":
      return { out: [0.42, 0], in: [0.58, 1] };
  }
};

export const evaluateKeyframeSegment = (
  left: KeyframeSnapshot,
  right: KeyframeSnapshot,
  frame: MasterFrame,
): TimelinePropertyValue | null => {
  if (
    left.ownerEntityId !== right.ownerEntityId ||
    left.propertyPath !== right.propertyPath ||
    right.frame <= left.frame ||
    frame < left.frame ||
    frame > right.frame
  ) {
    throw new RangeError("Keyframe evaluation requires an ordered matching segment and in-range frame.");
  }
  if (frame === left.frame || left.interpolation === "hold") return left.value;
  if (frame === right.frame) return right.value;
  if (left.interpolation === "native" || left.interpolation === "spring") return null;
  const raw = Number(frame - left.frame) / Number(right.frame - left.frame);
  return interpolateValue(left.value, right.value, interpolationProgress(left, right, raw));
};

export const sampleKeyframeCurve = (
  left: KeyframeSnapshot,
  right: KeyframeSnapshot,
  sampleCount = 33,
): readonly CurveSample[] => {
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 513) {
    throw new RangeError("Curve sample count must be an integer from 2 through 513.");
  }
  const duration = right.frame - left.frame;
  return Array.from({ length: sampleCount }, (_, index) => {
    const progress = index / (sampleCount - 1);
    const frame = masterFrame(left.frame + (duration * BigInt(index)) / BigInt(sampleCount - 1), true);
    const value = evaluateKeyframeSegment(left, right, frame);
    if (value === null || (typeof value !== "number" && !Array.isArray(value))) {
      throw new TypeError("Value and speed graphs require numeric keyframe values.");
    }
    const before = interpolationProgress(left, right, Math.max(0, progress - 0.0001));
    const after = interpolationProgress(left, right, Math.min(1, progress + 0.0001));
    const derivative = (after - before) / 0.0002;
    const speed = scaleValueDifference(left.value, right.value, derivative / Number(duration));
    return { frame, progress, value, speed };
  });
};

const interpolationProgress = (left: KeyframeSnapshot, right: KeyframeSnapshot, progress: number): number => {
  if (left.interpolation === "hold") return 0;
  if (left.interpolation === "linear") return progress;
  if (left.interpolation === "native" || left.interpolation === "spring") return progress;
  const tangents =
    left.interpolation === "bezier"
      ? {
          out: left.outTangent ?? ([0.33, 0.33] as const),
          in: right.inTangent ?? ([0.67, 0.67] as const),
        }
      : curveTangentsForPreset(left.interpolation);
  return cubicBezierYForX(progress, tangents.out, tangents.in);
};

const cubicBezierYForX = (
  x: number,
  out: readonly [number, number],
  incoming: readonly [number, number],
): number => {
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (cubic(middle, 0, out[0], incoming[0], 1) < x) lower = middle;
    else upper = middle;
  }
  return cubic((lower + upper) / 2, 0, out[1], incoming[1], 1);
};

const cubic = (t: number, p0: number, p1: number, p2: number, p3: number): number => {
  const inverse = 1 - t;
  return inverse ** 3 * p0 + 3 * inverse ** 2 * t * p1 + 3 * inverse * t ** 2 * p2 + t ** 3 * p3;
};

const interpolateValue = (
  left: TimelinePropertyValue,
  right: TimelinePropertyValue,
  progress: number,
): TimelinePropertyValue => {
  if (typeof left === "number" && typeof right === "number") return left + (right - left) * progress;
  if (isNumericVector(left) && isNumericVector(right) && left.length === right.length) {
    return left.map((value, index) => value + ((right[index] ?? value) - value) * progress);
  }
  return progress < 1 ? left : right;
};

const scaleValueDifference = (
  left: TimelinePropertyValue,
  right: TimelinePropertyValue,
  factor: number,
): number | readonly number[] => {
  if (typeof left === "number" && typeof right === "number") return (right - left) * factor;
  if (isNumericVector(left) && isNumericVector(right) && left.length === right.length) {
    return left.map((value, index) => ((right[index] ?? value) - value) * factor);
  }
  throw new TypeError("Speed graphs require matching numeric keyframe values.");
};

const isNumericVector = (value: TimelinePropertyValue): value is readonly number[] =>
  Array.isArray(value) && value.every((item: unknown): item is number => typeof item === "number");
