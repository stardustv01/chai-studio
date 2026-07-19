import type { CapabilityEngine, CapabilityRegistry } from "@chai-studio/engine-adapters";
import type { PreviewBlendMode, PreviewCrop, PreviewLayerTransform } from "../layer-compositor.js";
import type { PreviewFrameRange, PreviewRational } from "../master-clock.js";

export type SharedVisualKind = "image" | "video" | "solid";
export type SharedAlphaMode = "opaque" | "straight" | "premultiplied";

export interface SharedProxyDescriptor {
  readonly assetId: string;
  readonly contentHash: string;
  readonly sourceToProxyScale: PreviewRational;
  readonly sourceToProxyOffset: PreviewRational;
}

export interface SharedEffectsMetadata {
  readonly transform: PreviewLayerTransform;
  readonly opacity: number;
  readonly crop: PreviewCrop;
  readonly blendMode: PreviewBlendMode;
  readonly adjustmentRefs: readonly string[];
  readonly capabilities: readonly Readonly<{
    engine: CapabilityEngine;
    capabilityId: string;
  }>[];
}

interface SharedClipBase {
  readonly clipId: string;
  readonly layerId: string;
  readonly timelineRange: PreviewFrameRange;
  readonly alphaMode: SharedAlphaMode;
  readonly effects: SharedEffectsMetadata;
}

export interface SharedImageClip extends SharedClipBase {
  readonly kind: "image";
  readonly assetId: string;
  readonly contentHash: string;
}

export interface SharedVideoClip extends SharedClipBase {
  readonly kind: "video";
  readonly assetId: string;
  readonly contentHash: string;
  readonly sourceStartFrame: string;
  readonly timelineFps: PreviewRational;
  readonly sourceFps: PreviewRational;
  readonly speed: PreviewRational;
  readonly proxy: SharedProxyDescriptor | null;
}

export interface SharedSolidClip extends SharedClipBase {
  readonly kind: "solid";
  readonly color: Readonly<{ red: number; green: number; blue: number; alpha: number }>;
}

export interface SharedCaptionWord {
  readonly wordId: string;
  readonly text: string;
  readonly range: PreviewFrameRange;
}

export interface SharedCaptionCue {
  readonly cueId: string;
  readonly range: PreviewFrameRange;
  readonly text: string;
  readonly lines: readonly string[];
  readonly speaker: string | null;
  readonly styleId: string;
  readonly fontFileHash: string;
  readonly glyphHash: string;
  readonly words: readonly SharedCaptionWord[];
}

export interface SharedCaptionPlan {
  readonly planId: string;
  readonly layerId: string;
  readonly timelineRange: PreviewFrameRange;
  readonly width: number;
  readonly height: number;
  readonly fps: PreviewRational;
  readonly cues: readonly SharedCaptionCue[];
  readonly identity: string;
}

export interface SharedCaptionClip {
  readonly kind: "caption";
  readonly clipId: string;
  readonly layerId: string;
  readonly timelineRange: PreviewFrameRange;
  readonly alphaMode: "straight";
  readonly effects: SharedEffectsMetadata;
  readonly plan: SharedCaptionPlan;
}

export interface SharedFallbackProvenance {
  readonly provenanceId: string;
  readonly sourceIdentity: string;
  readonly sourceContentHash: string;
  readonly cacheKey: string;
  readonly environmentClass: string;
  readonly producerVersion: string;
  readonly createdBy: "proxy" | "bake";
  readonly fidelity: "equivalent" | "approximation";
  readonly approximationLimits: readonly string[];
}

export interface SharedFallbackClip extends SharedClipBase {
  readonly kind: "fallback";
  readonly assetId: string;
  readonly contentHash: string;
  readonly provenance: SharedFallbackProvenance;
}

export type SharedPreviewClip =
  SharedImageClip | SharedVideoClip | SharedSolidClip | SharedCaptionClip | SharedFallbackClip;

export interface SharedSourceSample {
  readonly timelineFrame: string;
  readonly exactSourceFrame: PreviewRational;
  readonly originalSourceFrame: string;
  readonly selectedAssetId: string;
  readonly selectedContentHash: string;
  readonly selectedSourceFrame: string;
  readonly usedProxy: boolean;
}

export interface SharedFrameProviderResult {
  readonly artifactIdentity: string;
  readonly freshness: "fresh" | "stale";
}

export interface SharedFrameProvider {
  preload(input: {
    readonly clip: SharedPreviewClip;
    readonly range: PreviewFrameRange;
    readonly signal: AbortSignal;
  }): Promise<"fresh" | "stale">;
  present(input: {
    readonly clip: SharedPreviewClip;
    readonly timelineFrame: string;
    readonly sourceSample: SharedSourceSample | null;
    readonly signal: AbortSignal;
  }): Promise<SharedFrameProviderResult>;
}

export interface SharedPreviewAdapterOptions {
  readonly adapterId: string;
  readonly clip: SharedPreviewClip;
  readonly provider?: SharedFrameProvider;
  readonly capabilityRegistry?: CapabilityRegistry;
  readonly preferProxy?: boolean;
}
