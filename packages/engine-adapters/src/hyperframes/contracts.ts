import type { NormalizedRational } from "@chai-studio/schema";

export const pinnedHyperframesVersion = "0.7.58" as const;

export type HyperframesTrustClass = "trusted-authored" | "imported-untrusted";
export type HyperframesDiagnosticSeverity = "info" | "warning" | "error";
export type HyperframesDiagnosticCategory =
  | "discovery"
  | "validation"
  | "runtime"
  | "layout"
  | "motion"
  | "contrast"
  | "dependency"
  | "policy"
  | "render"
  | "compatibility"
  | "cancellation";

export interface HyperframesDiagnostic {
  readonly category: HyperframesDiagnosticCategory;
  readonly code: string;
  readonly severity: HyperframesDiagnosticSeverity;
  readonly stage: string;
  readonly message: string;
  readonly repairHint: string;
  readonly sourcePath: string | null;
  readonly selector: string | null;
  readonly elementId: string | null;
  readonly adapterId: string | null;
  readonly compositionId: string | null;
  readonly frame: string | null;
}

export interface HyperframesApprovedNetworkResource {
  readonly url: string;
  readonly contentHash: string;
}

export interface HyperframesSourceDescriptor {
  readonly sourceId: string;
  readonly projectRoot: string;
  readonly entryFile: string;
  readonly compositionId: string | null;
  readonly declaredFps: NormalizedRational;
  readonly variableOverrides: Readonly<Record<string, unknown>>;
  readonly trustClass: HyperframesTrustClass;
  readonly approvedNetworkResources: readonly HyperframesApprovedNetworkResource[];
  readonly expectedVersion: string;
}

export type HyperframesVariableType = "string" | "number" | "boolean" | "color" | "image" | "video";

export interface HyperframesVariableDescriptor {
  readonly id: string;
  readonly label: string;
  readonly type: HyperframesVariableType;
  readonly defaultValue: unknown;
  readonly value: unknown;
  readonly safeToEdit: boolean;
  readonly warning: string | null;
}

export type HyperframesFrameAdapterKind =
  "gsap" | "lottie" | "three" | "rive" | "waapi" | "d3" | "pixijs" | "shader" | "custom";

export interface HyperframesFrameAdapterDescriptor {
  readonly kind: HyperframesFrameAdapterKind;
  readonly adapterId: string;
  readonly seekable: boolean;
  readonly sourcePath: string;
}

export interface HyperframesTrackDescriptor {
  readonly trackIndex: number;
  readonly elementCount: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface HyperframesCompositionDescriptor {
  readonly compositionId: string;
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: NormalizedRational;
  readonly durationSeconds: number;
  readonly durationFrames: string;
  readonly elementCount: number;
  readonly tracks: readonly HyperframesTrackDescriptor[];
  readonly timingAttributeCount: number;
  readonly variables: readonly HyperframesVariableDescriptor[];
  readonly frameAdapters: readonly HyperframesFrameAdapterDescriptor[];
  readonly adapterVersion: typeof pinnedHyperframesVersion;
}

export interface HyperframesDiscoveryReport {
  readonly sourceId: string;
  readonly compositions: readonly HyperframesCompositionDescriptor[];
  readonly selectedComposition: HyperframesCompositionDescriptor | null;
  readonly diagnostics: readonly HyperframesDiagnostic[];
  readonly valid: boolean;
}

export interface HyperframesValidationReport {
  readonly sourceId: string;
  readonly compositionId: string | null;
  readonly valid: boolean;
  readonly seekable: boolean;
  readonly diagnostics: readonly HyperframesDiagnostic[];
  readonly safeVariableIds: readonly string[];
  readonly blockedVariableIds: readonly string[];
  readonly workerPolicy: HyperframesWorkerPolicy;
}

export interface HyperframesWorkerPolicy {
  readonly policyVersion: "hyperframes-worker-policy.v1";
  readonly trustClass: HyperframesTrustClass;
  readonly workerId: string;
  readonly cacheNamespace: string;
  readonly networkMode: "approved-only" | "denied";
  readonly navigationAllowed: false;
  readonly popupsAllowed: false;
  readonly downloadsAllowed: false;
  readonly nativeAudioAllowed: false;
}

export interface HyperframesCliFinding {
  readonly code?: string;
  readonly severity?: string;
  readonly message?: string;
  readonly file?: string;
  readonly sourceFile?: string;
  readonly selector?: string;
  readonly hfId?: string;
  readonly adapter?: string;
  readonly time?: number;
}

export interface HyperframesCliEnvelope {
  readonly ok?: boolean;
  readonly findings?: readonly HyperframesCliFinding[];
  readonly lint?: Readonly<{ findings?: readonly HyperframesCliFinding[] }>;
  readonly runtime?: Readonly<{ findings?: readonly HyperframesCliFinding[] }>;
  readonly layout?: Readonly<{ findings?: readonly HyperframesCliFinding[] }>;
  readonly motion?: Readonly<{ findings?: readonly HyperframesCliFinding[] }>;
  readonly contrast?: Readonly<{ findings?: readonly HyperframesCliFinding[] }>;
  readonly _meta?: Readonly<{
    version?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
  }>;
}

export interface HyperframesDependencyEntry {
  readonly kind:
    | "html"
    | "css"
    | "media"
    | "font"
    | "script"
    | "adapter"
    | "package"
    | "shader"
    | "data"
    | "variables"
    | "approved-network";
  readonly identity: string;
  readonly projectRelativePath: string | null;
  readonly contentHash: string;
}

export interface HyperframesDependencySet {
  readonly schemaVersion: "1.0.0";
  readonly sourceId: string;
  readonly compositionId: string;
  readonly trustClass: HyperframesTrustClass;
  readonly cacheNamespace: string;
  readonly entries: readonly HyperframesDependencyEntry[];
  readonly dependencyGraphHash: string;
}

export interface HyperframesRenderEnvironment {
  readonly strictEnvironmentFingerprint: string;
  readonly browserIdentity: string;
  readonly browserExecutable: string;
  readonly colorContractId: string;
  readonly colorSpace: "srgb" | "display-p3";
  readonly alphaMode: "straight" | "premultiplied";
  readonly settingsHash: string;
}

export interface HyperframesStillArtifact {
  readonly kind: "hyperframes-still";
  readonly sourceId: string;
  readonly compositionId: string;
  readonly frame: string;
  readonly outputPath: string;
  readonly artifactHash: string;
  readonly normalizedPixelHash: string;
  readonly compositorId: "hyperframes-cli";
  readonly compositorVersion: typeof pinnedHyperframesVersion;
  readonly dependencyGraphHash: string;
  readonly strictEnvironmentFingerprint: string;
  readonly settingsHash: string;
  readonly colorContractId: string;
  readonly alphaMode: "straight" | "premultiplied";
  readonly browserIdentity: string;
  readonly trustClass: HyperframesTrustClass;
  readonly cacheNamespace: string;
  readonly diagnostics: readonly HyperframesDiagnostic[];
}

export interface HyperframesStillRequest {
  readonly source: HyperframesSourceDescriptor;
  readonly composition: HyperframesCompositionDescriptor;
  readonly frame: string;
  readonly outputPath: string;
  readonly environment: HyperframesRenderEnvironment;
  readonly dependencySet: HyperframesDependencySet;
  readonly signal: AbortSignal;
}

export interface HyperframesRangeProgress {
  readonly stage: "validating" | "capturing" | "encoding" | "committing";
  readonly progress: number;
  readonly message: string;
}

export interface HyperframesRangeArtifact {
  readonly kind: "hyperframes-range";
  readonly sourceId: string;
  readonly compositionId: string;
  readonly range: Readonly<{ startFrame: string; endFrameExclusive: string }>;
  readonly outputPath: string;
  readonly artifactHash: string;
  readonly codec: "h264" | "vp9" | "prores";
  readonly compositorId: "hyperframes-cli";
  readonly compositorVersion: typeof pinnedHyperframesVersion;
  readonly dependencyGraphHash: string;
  readonly strictEnvironmentFingerprint: string;
  readonly settingsHash: string;
  readonly colorContractId: string;
  readonly alphaMode: "straight" | "premultiplied";
  readonly browserIdentity: string;
  readonly trustClass: HyperframesTrustClass;
  readonly cacheNamespace: string;
  readonly diagnostics: readonly HyperframesDiagnostic[];
}

export interface HyperframesRangeRequest {
  readonly source: HyperframesSourceDescriptor;
  readonly composition: HyperframesCompositionDescriptor;
  readonly startFrame: string;
  readonly endFrameExclusive: string;
  readonly outputPath: string;
  readonly codec: "h264" | "vp9" | "prores";
  readonly environment: HyperframesRenderEnvironment;
  readonly dependencySet: HyperframesDependencySet;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: HyperframesRangeProgress) => void;
}

export interface HyperframesInspectorDescriptor {
  readonly compositionId: string;
  readonly sourcePath: string;
  readonly dimensions: Readonly<{ width: number; height: number }>;
  readonly fps: NormalizedRational;
  readonly durationFrames: string;
  readonly timingAttributeCount: number;
  readonly tracks: readonly HyperframesTrackDescriptor[];
  readonly variables: readonly HyperframesVariableDescriptor[];
  readonly frameAdapters: readonly HyperframesFrameAdapterDescriptor[];
  readonly warnings: readonly string[];
  readonly trust: Readonly<{
    trustClass: HyperframesTrustClass;
    policyVersion: HyperframesWorkerPolicy["policyVersion"];
    policyIdentity: string;
    networkMode: HyperframesWorkerPolicy["networkMode"];
    promotionRequired: boolean;
  }>;
  readonly capabilityClassifications: Readonly<
    Record<string, "native" | "unified" | "bake_required" | "unsupported">
  >;
}
