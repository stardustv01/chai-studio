import type { AudioOwnership } from "@chai-studio/audio";
import type { EngineAdapterOwnership } from "@chai-studio/engine-adapters";
export {
  applyPreviewControl,
  advancePreviewPlayback,
  applyPreviewPreload,
  createPreviewSessionState,
  updatePreviewAdapterDiagnostics,
  type PreviewAdapterDiagnostics,
  type PreviewAdapterStatus,
  type PreviewControl,
  type PreviewEngine,
  type PreviewQuality,
  type PreviewSessionState,
  type PreviewTransport,
  type PreviewTruthMode,
} from "./session-state.js";
export {
  canTransitionPreviewTransport,
  InvalidPreviewTransportTransitionError,
  previewTransportStates,
  previewTransportTransitions,
  transitionPreviewTransport,
  type PreviewTransportEvent,
  type PreviewTransportState,
} from "./transport-machine.js";
export {
  assertPositivePreviewRational,
  createPreviewFrameRange,
  framesForSecondStep,
  normalizePreviewRational,
  presentationTimestampForFrame,
  PreviewMasterClock,
  type MasterClockSnapshot,
  type PreviewFrameRange,
  type PreviewRational,
} from "./master-clock.js";
export {
  activePreviewLayers,
  calculatePreviewViewportFit,
  compositePreviewLayers,
  createPreviewLayerGraph,
  defaultPreviewTransform,
  emptyPreviewCrop,
  type PreviewBlendMode,
  type PreviewCompositeFrame,
  type PreviewCrop,
  type PreviewLayerNode,
  type PreviewLayerTransform,
  type PreviewViewportFit,
} from "./layer-compositor.js";
export {
  createPreviewIntegrityWarnings,
  resolvePreviewQualityPolicy,
  warning as createPreviewWarning,
  type PreviewLoadClass,
  type PreviewQualityPolicy,
} from "./quality-policy.js";
export {
  resolvePreviewDegradation,
  type PreviewDegradationLevel,
  type PreviewDegradationState,
  type PreviewDegradationStep,
} from "./degradation.js";
export {
  resolvePreviewAudioPolicy,
  type PreviewAudioInteraction,
  type PreviewAudioPolicy,
} from "./audio-policy.js";
export {
  aggregatePreviewBuffering,
  intersectRanges as intersectPreviewBufferedRanges,
  type PreviewBufferingSnapshot,
  type PreviewBufferWaitReason,
} from "./buffering.js";
export { PreviewLayerLifecycle, type PreviewLayerLifecycleSnapshot } from "./layer-lifecycle.js";
export {
  compareNormalizedPreviewPixels,
  deterministicPreviewPixelHash,
  normalizePreviewPixelBuffer,
  strictPreviewPixelContract,
  type NormalizedPreviewPixelBuffer,
  type PreviewAlphaMode,
  type PreviewColorSpace,
  type PreviewPixelBuffer,
  type PreviewPixelContract,
  type PreviewTransferFunction,
} from "./color-normalization.js";
export {
  canApplyPreviewSchedulerEvent,
  PreviewScheduler,
  type PreviewDriftItem,
  type PreviewDriftReport,
  type PreviewAudioSyncReport,
  type PreviewSchedulerOptions,
  type PreviewSchedulerSnapshot,
  type PreviewScrubResult,
  type PreviewSeekBarrierResult,
} from "./scheduler.js";
export { runPreviewAdapterConformance } from "./conformance.js";
export type {
  FidelityEnvironmentIdentity,
  FidelityFrameArtifact,
  FidelityRangeArtifact,
  PreviewAdapterConformanceResult,
  PreviewAudioFollower,
  PreviewFinalCompositor,
  PreviewLayerAdapter,
  PreviewLayerKind,
  PreviewLayerLifecycleState,
  PreviewPlaybackReport,
  PreviewPlaybackSession,
  PreviewPreloadResult,
  PreviewPresentationRequest,
  PreviewPresentedLayer,
  PreviewWarning,
  PreviewWarningCode,
} from "./preview-contract.js";
export {
  createSharedCaptionPlan,
  activeSharedCaptionCues,
  activeSharedCaptionWords,
} from "./shared/captions.js";
export { createSharedEffectsMetadata, sharedEffectWarnings } from "./shared/effects.js";
export { createSharedFallbackProvenance, sharedFallbackWarnings } from "./shared/fallback.js";
export { resolveSharedSourceAudioPolicy, type SharedSourceAudioPolicy } from "./shared/audio.js";
export { sampleSharedVideoSource } from "./shared/sampling.js";
export {
  sampleSharedTransition,
  sharedTransitionBoundaryOwner,
  type SharedTransitionKind,
  type SharedTransitionPrimitive,
  type SharedTransitionSample,
} from "./shared/transitions.js";
export { deterministicSharedFrameProvider, SharedPreviewAdapter } from "./shared/adapter.js";
export type {
  SharedAlphaMode,
  SharedCaptionClip,
  SharedCaptionCue,
  SharedCaptionPlan,
  SharedCaptionWord,
  SharedEffectsMetadata,
  SharedFallbackClip,
  SharedFallbackProvenance,
  SharedFrameProvider,
  SharedFrameProviderResult,
  SharedImageClip,
  SharedPreviewAdapterOptions,
  SharedPreviewClip,
  SharedProxyDescriptor,
  SharedSolidClip,
  SharedSourceSample,
  SharedVideoClip,
  SharedVisualKind,
} from "./shared/contracts.js";

export interface PreviewOwnership {
  readonly clock: EngineAdapterOwnership["follows"];
  readonly audio: AudioOwnership["owns"];
  readonly truthModes: readonly ["interactive-approximation", "rendered-fidelity"];
}

export const previewPackageBoundary: PreviewOwnership = {
  clock: "integer-master-frame",
  audio: "program-audio-graph",
  truthModes: ["interactive-approximation", "rendered-fidelity"],
};
