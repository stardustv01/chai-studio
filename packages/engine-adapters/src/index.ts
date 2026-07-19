import type { TimelineOwnership } from "@chai-studio/timeline";

export interface EngineAdapterOwnership {
  readonly follows: TimelineOwnership["authority"];
  readonly engines: readonly ["remotion", "hyperframes"];
}

export {
  capabilityStatuses,
  type CapabilityEngine,
  type CapabilityEntry,
  type CapabilityEvidence,
  type CapabilityFallback,
  type CapabilityFamily,
  type CapabilityFixture,
  type CapabilityInspectorDescriptor,
  type CapabilityPreviewWarning,
  type CapabilityRegistry,
  type CapabilityRenderDecision,
  type CapabilityStatus,
} from "./capabilities/contracts.js";
export { capabilityIdentity, createCapabilityRegistry, resolveCapability } from "./capabilities/registry.js";
export {
  buildCapabilityInspectorDescriptors,
  capabilityPreviewWarnings,
  planCapabilityRender,
  selectCapabilityFallback,
  selectCapabilityUpgradeFixtures,
} from "./capabilities/consumers.js";
export { initialCapabilityEntries, initialCapabilityRegistry } from "./capabilities/initial-registry.js";

export const engineAdaptersPackageBoundary: EngineAdapterOwnership = {
  follows: "integer-master-frame",
  engines: ["remotion", "hyperframes"],
};

export {
  pinnedRemotionVersion,
  type RemotionAdapterDiagnostic,
  type RemotionBrowserLogRecord,
  type RemotionCompositionDescriptor,
  type RemotionDependencyEntry,
  type RemotionDependencySet,
  type RemotionDiagnosticCategory,
  type RemotionDiagnosticSeverity,
  type RemotionDiscoveryReport,
  type RemotionFinishingCompositionPlan,
  type RemotionFinishingLayer,
  type RemotionInputPropSchema,
  type RemotionInspectorControl,
  type RemotionInspectorDescriptor,
  type RemotionNetworkResource,
  type RemotionRangeArtifact,
  type RemotionRangeProgress,
  type RemotionRangeRequest,
  type RemotionRenderEnvironment,
  type RemotionRuntimeComposition,
  type RemotionSourceDescriptor,
  type RemotionSourceStackFrame,
  type RemotionStillArtifact,
  type RemotionStillRequest,
  type RemotionValidationReport,
} from "./remotion/contracts.js";
export {
  browserLogToDiagnostic,
  parseRemotionSourceStack,
  remotionDiagnostic,
} from "./remotion/diagnostics.js";
export { discoverRemotionCompositions } from "./remotion/discovery.js";
export { validateRemotionSource, rationalFromRemotionFps } from "./remotion/validation.js";
export { NodeRemotionRuntime } from "./remotion/node-runtime.js";
export type {
  RemotionRuntime,
  RemotionRuntimeRenderRangeInput,
  RemotionRuntimeRenderStillInput,
} from "./remotion/runtime-contract.js";
export {
  RemotionPlayerHost,
  type RemotionPlayerFactory,
  type RemotionPlayerHandle,
  type RemotionPlayerHostOptions,
} from "./remotion/player-host.js";
export { normalizeRemotionPng, type NormalizedPngPixels } from "./remotion/png-normalization.js";
export { RemotionRenderCancelledError, RemotionRenderer } from "./remotion/renderer.js";
export { collectRemotionDependencies } from "./remotion/dependencies.js";
export { createRemotionInspectorDescriptor, remotionInspectorPropertyStates } from "./remotion/inspector.js";
export { generateRemotionFinishingComposition } from "./remotion/finishing.js";

export {
  pinnedHyperframesVersion,
  type HyperframesApprovedNetworkResource,
  type HyperframesCliEnvelope,
  type HyperframesCliFinding,
  type HyperframesCompositionDescriptor,
  type HyperframesDependencyEntry,
  type HyperframesDependencySet,
  type HyperframesDiagnostic,
  type HyperframesDiagnosticCategory,
  type HyperframesDiagnosticSeverity,
  type HyperframesDiscoveryReport,
  type HyperframesFrameAdapterDescriptor,
  type HyperframesFrameAdapterKind,
  type HyperframesInspectorDescriptor,
  type HyperframesRangeArtifact,
  type HyperframesRangeProgress,
  type HyperframesRangeRequest,
  type HyperframesRenderEnvironment,
  type HyperframesSourceDescriptor,
  type HyperframesStillArtifact,
  type HyperframesStillRequest,
  type HyperframesTrackDescriptor,
  type HyperframesTrustClass,
  type HyperframesValidationReport,
  type HyperframesVariableDescriptor,
  type HyperframesVariableType,
  type HyperframesWorkerPolicy,
} from "./hyperframes/contracts.js";
export { cliFindingToDiagnostic, hyperframesDiagnostic } from "./hyperframes/diagnostics.js";
export { parseHyperframesSource, type ParsedHyperframesSource } from "./hyperframes/parser.js";
export { discoverHyperframesCompositions } from "./hyperframes/discovery.js";
export { validateHyperframesSource } from "./hyperframes/validation.js";
export {
  HyperframesCliRuntime,
  type HyperframesCommandRuntime,
  type HyperframesProcessResult,
} from "./hyperframes/process-runtime.js";
export {
  HyperframesPlayerHost,
  type HyperframesPlayerFactory,
  type HyperframesPlayerHandle,
  type HyperframesPlayerHostOptions,
} from "./hyperframes/player-host.js";
export { assertHyperframesCachePolicy, selectHyperframesWorkerPolicy } from "./hyperframes/trust-policy.js";
export {
  HyperframesWorkerRouter,
  type HyperframesIsolationEvidence,
  type HyperframesWorkerSelection,
} from "./hyperframes/worker-router.js";
export { collectHyperframesDependencies } from "./hyperframes/dependencies.js";
export {
  createHyperframesInspectorDescriptor,
  hyperframesInspectorPropertyStates,
} from "./hyperframes/inspector.js";
export {
  HyperframesRenderCancelledError,
  HyperframesRenderer,
  type HyperframesRangeEncoder,
} from "./hyperframes/renderer.js";
