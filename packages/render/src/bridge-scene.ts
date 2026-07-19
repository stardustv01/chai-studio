import type { JsonValue } from "@chai-studio/schema";
import type { RenderFrameRange } from "./contracts.js";
import { hashCanonicalRenderValue } from "./identity.js";

export interface BridgeSceneDocument {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly outgoingClipId: string;
  readonly incomingClipId: string;
  readonly outgoingRange: RenderFrameRange;
  readonly incomingRange: RenderFrameRange;
  readonly timelineRange: RenderFrameRange;
  readonly durationFrames: string;
  readonly owner: "remotion" | "hyperframes" | "shared";
  readonly alphaMode: "straight" | "premultiplied";
  readonly pixelFormat: string;
  readonly colorSpace: string;
  readonly audioEnvelope: Readonly<{
    outgoingStart: number;
    outgoingEnd: number;
    incomingStart: number;
    incomingEnd: number;
  }>;
  readonly fallback: Readonly<{ kind: "cut" | "cross-dissolve"; reason: string }>;
  readonly preRollFrames: string;
  readonly postRollFrames: string;
  readonly cacheKey: string;
}

export interface ValidatedBridgeScene extends BridgeSceneDocument {
  readonly boundaryIdentityHash: string;
  readonly expectedFrameCount: string;
}

export const validateBridgeScene = (scene: BridgeSceneDocument): ValidatedBridgeScene => {
  const outgoing = range(scene.outgoingRange, "outgoing");
  const incoming = range(scene.incomingRange, "incoming");
  const timeline = range(scene.timelineRange, "timeline");
  const duration = positive(scene.durationFrames, "duration");
  const preRoll = nonNegative(scene.preRollFrames, "pre-roll");
  const postRoll = nonNegative(scene.postRollFrames, "post-roll");
  if (outgoing.length !== duration || incoming.length !== duration || timeline.length !== duration) {
    throw new Error("Bridge ranges must each contain the exact declared duration.");
  }
  if (scene.outgoingClipId === scene.incomingClipId) {
    throw new Error("Bridge scene must connect two distinct stable clips.");
  }
  if (!/^[a-f0-9]{64}$/.test(scene.cacheKey)) throw new Error("Bridge cache key is invalid.");
  for (const value of Object.values(scene.audioEnvelope)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("Bridge audio envelope values must be finite normalized gains.");
    }
  }
  if (scene.fallback.reason.trim() === "") throw new Error("Bridge fallback reason is required.");
  const boundaryIdentityHash = hashCanonicalRenderValue({
    ...scene,
    preRollFrames: preRoll.toString(10),
    postRollFrames: postRoll.toString(10),
  } as unknown as JsonValue);
  return { ...scene, boundaryIdentityHash, expectedFrameCount: duration.toString(10) };
};

const range = (value: RenderFrameRange, label: string): { start: bigint; end: bigint; length: bigint } => {
  const start = nonNegative(value.startFrame, `${label} start`);
  const end = positive(value.endFrameExclusive, `${label} end`);
  if (end <= start) throw new Error(`Bridge ${label} range must be non-empty and half-open.`);
  return { start, end, length: end - start };
};

const positive = (value: string, label: string): bigint => {
  const parsed = nonNegative(value, label);
  if (parsed === 0n) throw new Error(`Bridge ${label} must be positive.`);
  return parsed;
};

const nonNegative = (value: string, label: string): bigint => {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(value)) throw new Error(`Bridge ${label} is invalid.`);
  return BigInt(value);
};
