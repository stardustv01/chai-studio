import type { NormalizedRational } from "@chai-studio/schema";

export const pinnedRemotionVersion = "4.0.489" as const;

export type RemotionDiagnosticSeverity = "info" | "warning" | "error";
export type RemotionDiagnosticCategory =
  | "discovery"
  | "validation"
  | "browser"
  | "delay"
  | "load"
  | "render"
  | "asset"
  | "compatibility"
  | "cancellation";

export interface RemotionAdapterDiagnostic {
  readonly category: RemotionDiagnosticCategory;
  readonly code: string;
  readonly severity: RemotionDiagnosticSeverity;
  readonly stage: string;
  readonly message: string;
  readonly repairHint: string;
  readonly sourcePath: string | null;
  readonly compositionId: string | null;
  readonly frame: string | null;
  readonly stack: readonly RemotionSourceStackFrame[];
}

export interface RemotionSourceStackFrame {
  readonly functionName: string | null;
  readonly sourcePath: string;
  readonly line: number | null;
  readonly column: number | null;
}

export type RemotionInputPropSchema = Readonly<{
  type: "object";
  required?: readonly string[];
  properties: Readonly<
    Record<
      string,
      Readonly<{
        type: "string" | "number" | "integer" | "boolean" | "array" | "object";
        title?: string;
        description?: string;
        enum?: readonly (string | number | boolean)[];
        minimum?: number;
        maximum?: number;
        readOnly?: boolean;
      }>
    >
  >;
  additionalProperties?: boolean;
}>;

export interface RemotionNetworkResource {
  readonly url: string;
  readonly contentHash: string;
}

export interface RemotionSourceDescriptor {
  readonly sourceId: string;
  readonly projectRoot: string;
  readonly entryPoint: string;
  readonly componentPath: string;
  readonly compositionId: string | null;
  readonly declaredFps: NormalizedRational;
  readonly inputProps: Readonly<Record<string, unknown>>;
  readonly inputPropsSchema: RemotionInputPropSchema | null;
  readonly allowDelayRender: boolean;
  readonly delayTimeoutMs: number;
  readonly assetPaths: readonly string[];
  readonly fontPaths: readonly string[];
  readonly generatedCodePaths: readonly string[];
  readonly approvedNetworkResources: readonly RemotionNetworkResource[];
  readonly expectedVersions: Readonly<{
    remotion: string;
    renderer: string;
    bundler: string;
    player: string;
  }>;
}

export interface RemotionRuntimeComposition {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly props: Readonly<Record<string, unknown>>;
  readonly defaultProps: Readonly<Record<string, unknown>>;
  readonly defaultCodec: string | null;
  readonly defaultOutName: string | null;
  readonly defaultVideoImageFormat: string | null;
  readonly defaultPixelFormat: string | null;
  readonly defaultProResProfile: string | null;
  readonly defaultSampleRate: number | null;
}

export interface RemotionCompositionDescriptor {
  readonly compositionId: string;
  readonly sourceId: string;
  readonly componentPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: NormalizedRational;
  readonly durationFrames: string;
  readonly defaultProps: Readonly<Record<string, unknown>>;
  readonly calculatedProps: Readonly<Record<string, unknown>>;
  readonly inputPropsSchema: RemotionInputPropSchema | null;
  readonly adapterVersion: typeof pinnedRemotionVersion;
}

export interface RemotionDiscoveryReport {
  readonly sourceId: string;
  readonly serveUrl: string | null;
  readonly compositions: readonly RemotionCompositionDescriptor[];
  readonly selectedComposition: RemotionCompositionDescriptor | null;
  readonly diagnostics: readonly RemotionAdapterDiagnostic[];
  readonly valid: boolean;
}

export interface RemotionValidationReport {
  readonly sourceId: string;
  readonly compositionId: string | null;
  readonly valid: boolean;
  readonly diagnostics: readonly RemotionAdapterDiagnostic[];
  readonly safeInputPropNames: readonly string[];
  readonly blockedInputPropNames: readonly string[];
}

export interface RemotionBrowserLogRecord {
  readonly level: "verbose" | "info" | "warning" | "error";
  readonly text: string;
  readonly sourceUrl: string | null;
  readonly stack: readonly RemotionSourceStackFrame[];
  readonly compositionId: string;
  readonly frame: string | null;
  readonly occurredAt: string;
}

export interface RemotionDependencyEntry {
  readonly kind:
    | "source-module"
    | "input-props"
    | "media"
    | "font"
    | "runtime-package"
    | "approved-network"
    | "generated-code";
  readonly identity: string;
  readonly projectRelativePath: string | null;
  readonly contentHash: string;
}

export interface RemotionDependencySet {
  readonly schemaVersion: "1.0.0";
  readonly sourceId: string;
  readonly compositionId: string;
  readonly entries: readonly RemotionDependencyEntry[];
  readonly dependencyGraphHash: string;
}

export interface RemotionRenderEnvironment {
  readonly strictEnvironmentFingerprint: string;
  readonly browserExecutable: string;
  readonly browserIdentity: string;
  readonly colorContractId: string;
  readonly colorSpace: "default" | "bt709" | "bt2020-ncl";
  readonly alphaMode: "straight" | "premultiplied";
  readonly settingsHash: string;
}

export interface RemotionStillRequest {
  readonly source: RemotionSourceDescriptor;
  readonly composition: RemotionCompositionDescriptor;
  readonly serveUrl?: string;
  readonly frame: string;
  readonly outputPath: string;
  readonly imageFormat: "png";
  readonly environment: RemotionRenderEnvironment;
  readonly dependencySet: RemotionDependencySet;
  readonly signal: AbortSignal;
}

export interface RemotionStillArtifact {
  readonly kind: "remotion-still";
  readonly sourceId: string;
  readonly compositionId: string;
  readonly frame: string;
  readonly outputPath: string;
  readonly artifactHash: string;
  readonly normalizedPixelHash: string;
  readonly compositorId: "remotion-renderer";
  readonly compositorVersion: typeof pinnedRemotionVersion;
  readonly dependencyGraphHash: string;
  readonly strictEnvironmentFingerprint: string;
  readonly settingsHash: string;
  readonly colorContractId: string;
  readonly alphaMode: "straight" | "premultiplied";
  readonly browserIdentity: string;
  readonly diagnostics: readonly RemotionAdapterDiagnostic[];
}

export interface RemotionRangeRequest {
  readonly source: RemotionSourceDescriptor;
  readonly composition: RemotionCompositionDescriptor;
  readonly serveUrl?: string;
  readonly startFrame: string;
  readonly endFrameExclusive: string;
  readonly outputPath: string;
  readonly codec: "h264" | "h265" | "vp8" | "vp9" | "prores";
  readonly environment: RemotionRenderEnvironment;
  readonly dependencySet: RemotionDependencySet;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: RemotionRangeProgress) => void;
}

export interface RemotionRangeProgress {
  readonly stage: "rendering" | "encoding" | "muxing";
  readonly progress: number;
  readonly renderedFrames: number;
  readonly encodedFrames: number;
}

export interface RemotionRangeArtifact {
  readonly kind: "remotion-range";
  readonly sourceId: string;
  readonly compositionId: string;
  readonly range: Readonly<{ startFrame: string; endFrameExclusive: string }>;
  readonly outputPath: string;
  readonly artifactHash: string;
  readonly codec: RemotionRangeRequest["codec"];
  readonly compositorId: "remotion-renderer";
  readonly compositorVersion: typeof pinnedRemotionVersion;
  readonly dependencyGraphHash: string;
  readonly strictEnvironmentFingerprint: string;
  readonly settingsHash: string;
  readonly colorContractId: string;
  readonly alphaMode: "straight" | "premultiplied";
  readonly browserIdentity: string;
  readonly diagnostics: readonly RemotionAdapterDiagnostic[];
}

export interface RemotionInspectorControl {
  readonly propName: string;
  readonly label: string;
  readonly control: "text" | "number" | "integer" | "boolean" | "select" | "readonly-json";
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly value: unknown;
  readonly options: readonly (string | number | boolean)[];
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly warning: string | null;
}

export interface RemotionInspectorDescriptor {
  readonly compositionId: string;
  readonly sourcePath: string;
  readonly dimensions: Readonly<{ width: number; height: number }>;
  readonly fps: NormalizedRational;
  readonly durationFrames: string;
  readonly adapterVersion: typeof pinnedRemotionVersion;
  readonly controls: readonly RemotionInspectorControl[];
  readonly warnings: readonly string[];
  readonly capabilityClassifications: Readonly<Record<string, "native" | "unified" | "bake_required">>;
}

export interface RemotionFinishingLayer {
  readonly layerId: string;
  readonly artifactPath: string;
  readonly startFrame: string;
  readonly durationFrames: string;
  readonly zIndex: number;
  readonly hasAlpha: boolean;
}

export interface RemotionFinishingCompositionPlan {
  readonly interfaceVersion: "chai-finishing-compositor.v1";
  readonly compositionId: string;
  readonly width: number;
  readonly height: number;
  readonly fps: NormalizedRational;
  readonly durationFrames: string;
  readonly sourceCode: string;
  readonly sourceHash: string;
  readonly dependencies: readonly string[];
}
