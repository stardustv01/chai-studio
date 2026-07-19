import type { PreviewFrameRange } from "../master-clock.js";

export type SharedTransitionKind =
  "hard-cut" | "dissolve" | "dip" | "wipe" | "push" | "slide" | "zoom" | "blur";

export interface SharedTransitionPrimitive {
  readonly transitionId: string;
  readonly kind: SharedTransitionKind;
  readonly range: PreviewFrameRange;
  readonly outgoingClipId: string;
  readonly incomingClipId: string;
  readonly direction?: "left" | "right" | "up" | "down";
  readonly dipColor?: Readonly<{ red: number; green: number; blue: number }>;
}

export interface SharedTransitionSample {
  readonly transitionId: string;
  readonly kind: SharedTransitionKind;
  readonly frame: string;
  readonly owner: "transition";
  readonly progress: number;
  readonly outgoingWeight: number;
  readonly incomingWeight: number;
  readonly matteWeight: number;
  readonly outgoingTransform: Readonly<{
    translateX: number;
    translateY: number;
    scale: number;
    blur: number;
  }>;
  readonly incomingTransform: Readonly<{
    translateX: number;
    translateY: number;
    scale: number;
    blur: number;
  }>;
  readonly wipeProgress: number;
}

export const sampleSharedTransition = (
  transition: SharedTransitionPrimitive,
  frameInput: string,
): SharedTransitionSample => {
  const frame = BigInt(frameInput);
  const start = BigInt(transition.range.startFrame);
  const end = BigInt(transition.range.endFrameExclusive);
  if (end <= start) throw new Error(`Transition ${transition.transitionId} has an empty range.`);
  if (frame < start || frame >= end) {
    throw new Error(`Frame ${frameInput} is outside transition ${transition.transitionId}.`);
  }
  const duration = end - start;
  const offset = frame - start;
  const progress = duration === 1n ? 1 : Number(offset) / Number(duration - 1n);
  const direction = transition.direction ?? "left";
  const vector = directionVector(direction);
  let outgoingWeight = 1 - progress;
  let incomingWeight = progress;
  let matteWeight = 0;
  let wipeProgress = 0;
  let outgoingTransform = transform();
  let incomingTransform = transform();
  if (transition.kind === "hard-cut") {
    outgoingWeight = progress < 0.5 ? 1 : 0;
    incomingWeight = outgoingWeight === 1 ? 0 : 1;
  } else if (transition.kind === "dip") {
    if (progress <= 0.5) {
      outgoingWeight = 1 - progress * 2;
      incomingWeight = 0;
      matteWeight = progress * 2;
    } else {
      outgoingWeight = 0;
      incomingWeight = (progress - 0.5) * 2;
      matteWeight = 1 - incomingWeight;
    }
  } else if (transition.kind === "wipe") {
    outgoingWeight = 1;
    incomingWeight = 1;
    wipeProgress = progress;
  } else if (transition.kind === "push") {
    outgoingWeight = 1;
    incomingWeight = 1;
    outgoingTransform = transform(vector.x * -progress, vector.y * -progress);
    incomingTransform = transform(vector.x * (1 - progress), vector.y * (1 - progress));
  } else if (transition.kind === "slide") {
    outgoingWeight = 1;
    incomingWeight = 1;
    incomingTransform = transform(vector.x * (1 - progress), vector.y * (1 - progress));
  } else if (transition.kind === "zoom") {
    outgoingTransform = transform(0, 0, 1 + progress * 0.08);
    incomingTransform = transform(0, 0, 0.92 + progress * 0.08);
  } else if (transition.kind === "blur") {
    outgoingTransform = transform(0, 0, 1, progress * 20);
    incomingTransform = transform(0, 0, 1, (1 - progress) * 20);
  }
  return {
    transitionId: transition.transitionId,
    kind: transition.kind,
    frame: frame.toString(),
    owner: "transition",
    progress,
    outgoingWeight,
    incomingWeight,
    matteWeight,
    outgoingTransform,
    incomingTransform,
    wipeProgress,
  };
};

export const sharedTransitionBoundaryOwner = (
  transition: SharedTransitionPrimitive,
  frameInput: string,
): "outgoing" | "transition" | "incoming" => {
  const frame = BigInt(frameInput);
  if (frame < BigInt(transition.range.startFrame)) return "outgoing";
  if (frame >= BigInt(transition.range.endFrameExclusive)) return "incoming";
  return "transition";
};

const directionVector = (direction: NonNullable<SharedTransitionPrimitive["direction"]>) => {
  if (direction === "left") return { x: -1, y: 0 };
  if (direction === "right") return { x: 1, y: 0 };
  if (direction === "up") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
};

const transform = (translateX = 0, translateY = 0, scale = 1, blur = 0) => ({
  translateX,
  translateY,
  scale,
  blur,
});
