import type { GeneratedDiagnosticCategory } from "@chai-studio/schema";

export interface MediaOwnership {
  readonly owns: "asset-registry-and-proxies";
  readonly diagnostics: GeneratedDiagnosticCategory;
}

export const mediaPackageBoundary: MediaOwnership = {
  owns: "asset-registry-and-proxies",
  diagnostics: "media",
};

export {
  auditAssetRegistry,
  normalizeAssetRegistryPath,
  prepareAssetRegistration,
  registerAssetRecord,
  sha256File,
  type AssetRegistryAudit,
  type AssetRegistryIssue,
  type PrepareAssetRegistrationInput,
} from "./asset-registry.js";
export {
  authorizeAssetPath,
  isContainedPath,
  type ApprovedExternalAssetRoot,
  type AuthorizedAssetPath,
  type AuthorizeAssetPathInput,
} from "./path-policy.js";
export {
  assertMediaInspection,
  inspectMediaFile,
  parseFfprobeOutput,
  type InspectedAudioStream,
  type InspectedVideoStream,
  type InspectMediaFileInput,
  type MediaInspectionV1,
} from "./media-inspection.js";
export {
  detectAssetSourceChanges,
  findDuplicateAssets,
  type AssetDuplicateGroup,
  type AssetSourceChange,
  type AssetSourceChangeState,
  type AssetSourceObservation,
} from "./asset-change-detection.js";
export {
  buildSourceToProxyTimeMap,
  detectVariableFrameRateFromTimestamps,
  type BuildSourceToProxyTimeMapInput,
  type ProxyFrameTimeMapping,
  type SourceFrameTimestamp,
  type SourceToProxyTimeMapV1,
} from "./proxy-time-map.js";
export {
  assertFinalRenderUsesOriginals,
  fingerprintProxyProfile,
  generateConstantFrameRateProxy,
  proxyArguments,
  proxyArtifactIsCurrent,
  proxyCacheKey,
  resolvePreviewMedia,
  type GenerateProxyInput,
  type GeneratedProxyArtifact,
  type PreviewMediaResolution,
  type ProxyProfile,
} from "./proxy-manager.js";
export { ProxyJobController, type ProxyJobSnapshot, type ProxyJobStatus } from "./proxy-jobs.js";
export {
  buildWaveformEnvelope,
  fingerprintGeneratedViewProfile,
  generateMediaView,
  generatedViewCacheKey,
  generatedViewFfmpegArguments,
  generatedViewIsCurrent,
  type ContactSheetViewProfile,
  type FilmstripViewProfile,
  type GeneratedViewArtifact,
  type GeneratedViewProducerContext,
  type GeneratedViewProfile,
  type GenerateMediaViewInput,
  type ThumbnailViewProfile,
  type WaveformEnvelopeV1,
  type WaveformViewProfile,
} from "./generated-views.js";
export {
  assertProjectFontsResolved,
  createProjectFontManifest,
  fingerprintResolvedFonts,
  fontManifestToAssetRecord,
  fontRecordToAssetRecord,
  parseOpenTypeFontIdentity,
  prepareFontRegistration,
  resolveProjectFonts,
  serializeProjectFontManifest,
  type FontIdentity,
  type FontResolutionIssue,
  type FontResolutionReport,
  type PrepareFontRegistrationInput,
  type ProjectFontManifestV1,
  type ProjectFontRecord,
  type ResolvedProjectFont,
} from "./font-registry.js";
export {
  buildAssetIndex,
  searchAssetIndex,
  type AssetIndexBuildSources,
  type AssetIndexEntry,
  type AssetSearchPage,
  type AssetSearchQuery,
} from "./asset-index.js";
export {
  applyAssetMutation,
  buildAssetUsageReport,
  createAssetRelinkTransaction,
  createAssetReplaceTransaction,
  createRevealAssetPlan,
  type AssetMutationResult,
  type AssetMutationV1,
  type AssetUsageLocation,
  type AssetUsageReport,
  type RevealAssetPlan,
  type ReversibleAssetTransactionV1,
} from "./asset-workflows.js";
export {
  applyAssetCurationMutation,
  assetCurationManifestToAssetRecord,
  buildDuplicateReviewQueue,
  createAssetCurationManifest,
  serializeAssetCurationManifest,
  updateAssetCuration,
  type AssetCurationManifestV1,
  type AssetCurationMutationResult,
  type AssetCurationMutationV1,
  type AssetCurationRecord,
  type DuplicateReviewGroup,
} from "./asset-curation.js";
export {
  assetRightsManifestToAssetRecord,
  createAssetRightsManifest,
  fingerprintAssetRightsManifest,
  preflightDeliveryRights,
  serializeAssetRightsManifest,
  type AssetRightsManifestV1,
  type AssetRightsProof,
  type AssetRightsRecord,
  type DeliveryRightsIssue,
  type DeliveryRightsPolicy,
  type DeliveryRightsPreflightReport,
} from "./asset-rights.js";
