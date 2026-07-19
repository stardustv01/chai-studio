import type { PreviewFrameRange, PreviewRational } from "./master-clock.js";

export type PreviewLayerKind =
  "remotion" | "hyperframes" | "shared" | "baked-fallback" | "guide" | "annotation";

export type PreviewLayerLifecycleState =
  "unloaded" | "preloading" | "ready" | "presenting" | "suspended" | "error" | "disposed";

export type PreviewWarningCode =
  | "proxy-in-use"
  | "baked-fallback"
  | "unsupported-effect"
  | "missing-asset"
  | "missing-font"
  | "stale-cache"
  | "buffering"
  | "dropped-frames"
  | "render-required-difference"
  | "layer-failed"
  | "audio-muted-for-rate";

export interface PreviewWarning {
  readonly code: PreviewWarningCode;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly layerId: string | null;
  readonly remedy: Readonly<{ label: string; action: string }>;
}

export interface PreviewPresentationRequest {
  readonly schedulerSessionId: string;
  readonly frame: string;
  readonly presentationTimestamp: PreviewRational;
  readonly truthMode: "interactive-approximation" | "rendered-fidelity";
  readonly signal: AbortSignal;
}

export interface PreviewPresentedLayer {
  readonly adapterId: string;
  readonly layerId: string;
  readonly frame: string;
  readonly ready: true;
  readonly artifactIdentity: string;
  readonly usedProxy: boolean;
  readonly usedBakedFallback: boolean;
  readonly warnings: readonly PreviewWarning[];
}

export interface PreviewPlaybackSession {
  readonly schedulerSessionId: string;
  readonly startFrame: string;
  readonly startPresentationTimestamp: PreviewRational;
  readonly timelineFps: PreviewRational;
  readonly playRate: PreviewRational;
  readonly nativeAudioSuppressed: true;
  readonly signal: AbortSignal;
}

export interface PreviewPlaybackReport {
  readonly adapterId: string;
  readonly schedulerSessionId: string;
  readonly observedFrame: string;
  readonly droppedFrames: number;
  readonly reportedAtMonotonicMs: number;
}

export interface PreviewPreloadResult {
  readonly adapterId: string;
  readonly layerId: string;
  readonly range: PreviewFrameRange;
  readonly freshness: "fresh" | "stale";
  readonly waitingFor: "none" | "media" | "engine" | "render-fallback" | "audio";
}

export interface PreviewLayerAdapter {
  readonly adapterId: string;
  readonly layerId: string;
  readonly kind: PreviewLayerKind;
  readonly version: string;
  preload(range: PreviewFrameRange, signal: AbortSignal): Promise<PreviewPreloadResult>;
  halt(schedulerSessionId: string): Promise<void>;
  presentFrame(request: PreviewPresentationRequest): Promise<PreviewPresentedLayer>;
  beginSynchronizedPlayback(session: PreviewPlaybackSession): Promise<void>;
  reportPlaybackState(schedulerSessionId: string): Promise<PreviewPlaybackReport>;
  suspend(): Promise<void>;
  dispose(): Promise<void>;
}

export interface PreviewAudioFollower {
  readonly followerId: string;
  halt(schedulerSessionId: string): Promise<void>;
  prepare(input: {
    readonly schedulerSessionId: string;
    readonly frame: string;
    readonly presentationTimestamp: PreviewRational;
    readonly signal: AbortSignal;
  }): Promise<
    Readonly<{ ready: true; expectedSample: string; baseLatencyMs: number; outputLatencyMs: number }>
  >;
  begin(session: PreviewPlaybackSession): Promise<void>;
  auditionScrub?(input: {
    readonly schedulerSessionId: string;
    readonly frame: string;
    readonly presentationTimestamp: PreviewRational;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ auditioned: boolean; grainDurationMs: number }>>;
  report(schedulerSessionId: string): Promise<
    Readonly<{
      observedSample: string;
      expectedSample: string;
      baseLatencyMs: number;
      outputLatencyMs: number;
    }>
  >;
  suspend(): Promise<void>;
  dispose(): Promise<void>;
}

export interface FidelityEnvironmentIdentity {
  readonly strictEnvironmentFingerprint: string;
  readonly compositorId: string;
  readonly compositorVersion: string;
  readonly dependencyGraphHash: string;
  readonly settingsHash: string;
  readonly colorContractId: string;
  readonly alphaMode: "straight" | "premultiplied";
}

export interface FidelityFrameArtifact extends FidelityEnvironmentIdentity {
  readonly frame: string;
  readonly artifactPath: string;
  readonly artifactHash: string;
  readonly normalizedPixelHash: string;
}

export interface FidelityRangeArtifact extends FidelityEnvironmentIdentity {
  readonly range: PreviewFrameRange;
  readonly artifactPath: string;
  readonly artifactHash: string;
}

export interface PreviewFinalCompositor {
  renderFrame(input: {
    readonly projectId: string;
    readonly revisionId: string;
    readonly timelineId: string;
    readonly frame: string;
    readonly signal: AbortSignal;
  }): Promise<FidelityFrameArtifact>;
  renderRange(input: {
    readonly projectId: string;
    readonly revisionId: string;
    readonly timelineId: string;
    readonly range: PreviewFrameRange;
    readonly signal: AbortSignal;
  }): Promise<FidelityRangeArtifact>;
}

export interface PreviewAdapterConformanceResult {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly passed: boolean;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly failures: readonly string[];
}
