import type { JsonValue, NormalizedRational } from "@chai-studio/schema";

export const renderDagSchemaVersion = "1.0.0" as const;

export type RenderNodeKind =
  | "validate"
  | "dependencies"
  | "cache-key"
  | "native-remotion"
  | "native-hyperframes"
  | "shared-media"
  | "caption"
  | "bridge"
  | "master-composition"
  | "audio-mix"
  | "encode"
  | "still"
  | "contact-sheet"
  | "qa"
  | "receipt";

export type RenderOutputClass =
  | "delivery"
  | "still"
  | "thumbnail"
  | "contact-sheet"
  | "image-sequence"
  | "transparent-overlay"
  | "mezzanine"
  | "review-proxy"
  | "audio-only";

export type RenderExecutionPath =
  "native" | "unified" | "baked" | "fallback" | "unsupported" | "experimental";

export interface RenderFrameRange {
  readonly startFrame: string;
  readonly endFrameExclusive: string;
}

export interface RenderArtifactDescriptor {
  readonly artifactId: string;
  readonly class: RenderOutputClass | "intermediate" | "audio" | "caption" | "receipt";
  readonly mediaType: string;
  readonly extension: string;
  readonly frameRange: RenderFrameRange | null;
  readonly alphaMode: "opaque" | "straight" | "premultiplied" | null;
  readonly colorSpace: string | null;
  readonly pixelFormat: string | null;
}

export interface RenderDagNode {
  readonly schemaVersion: typeof renderDagSchemaVersion;
  readonly id: string;
  readonly kind: RenderNodeKind;
  readonly label: string;
  readonly dependsOn: readonly string[];
  readonly input: JsonValue;
  readonly expectedOutputs: readonly RenderArtifactDescriptor[];
  readonly cachePolicy: "strict" | "portable-proven" | "never";
  readonly trustClass: "trusted-authored" | "imported-untrusted";
  readonly resources: Readonly<{
    cpu: number;
    memoryMiB: number;
    gpu: "none" | "shared" | "exclusive";
    browser: boolean;
  }>;
  readonly retryPolicy: Readonly<{
    maxAttempts: number;
    resumable: boolean;
    retryableStages: readonly string[];
  }>;
}

export interface RenderDag {
  readonly schemaVersion: typeof renderDagSchemaVersion;
  readonly id: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly range: RenderFrameRange;
  readonly fps: NormalizedRational;
  readonly nodes: readonly RenderDagNode[];
  readonly roots: readonly string[];
}

export type RenderDependencyCategory =
  | "project"
  | "timeline"
  | "asset"
  | "font"
  | "adapter"
  | "audio"
  | "effect"
  | "bridge"
  | "environment"
  | "lockfile"
  | "network";

export interface RenderDependencyEntry {
  readonly category: RenderDependencyCategory;
  readonly id: string;
  readonly contentHash: string;
  readonly source: string;
  readonly requiredBy: readonly string[];
  readonly portability: "strict" | "portable-proven";
  readonly metadata: Readonly<Record<string, JsonValue>>;
}

export interface RenderDependencyManifest {
  readonly schemaVersion: "1.0.0";
  readonly entries: readonly RenderDependencyEntry[];
  readonly identityHash: string;
}

export interface StrictEnvironmentManifest {
  readonly schemaVersion: "1.0.0";
  readonly os: string;
  readonly architecture: string;
  readonly osVersion: string;
  readonly gpu: string;
  readonly nodeVersion: string;
  readonly browserExecutableHash: string;
  readonly browserIdentity: string;
  readonly rendererVersions: Readonly<Record<string, string>>;
  readonly ffmpegVersion: string;
  readonly locale: string;
  readonly timezone: string;
  readonly colorContractId: string;
  readonly lockfileHash: string;
}

export interface PreviewEnvironmentManifest {
  readonly schemaVersion: "1.0.0";
  readonly architecture: string;
  readonly browserMajor: string;
  readonly rendererVersions: Readonly<Record<string, string>>;
  readonly colorContractId: string;
}

export interface RenderEnvironmentIdentity {
  readonly strictEnvironmentFingerprint: string;
  readonly compatiblePreviewFingerprint: string;
  readonly strictManifest: StrictEnvironmentManifest;
  readonly previewManifest: PreviewEnvironmentManifest;
}

export interface RenderCacheKeyInput {
  readonly schemaVersion: "1.0.0";
  readonly nodeKind: RenderNodeKind;
  readonly nodeInput: JsonValue;
  readonly dependencyManifestHash: string;
  readonly strictEnvironmentFingerprint: string;
  readonly portableEnvironmentContractHash: string | null;
  readonly sourceHashes: readonly string[];
  readonly propsAndVariables: JsonValue;
  readonly assetHashes: readonly string[];
  readonly fontHashes: readonly string[];
  readonly versions: Readonly<Record<string, string>>;
  readonly dimensions: Readonly<{ width: number; height: number }>;
  readonly fps: NormalizedRational;
  readonly range: RenderFrameRange;
  readonly colorSpace: string;
  readonly alphaMode: "opaque" | "straight" | "premultiplied";
  readonly pixelFormat: string;
  readonly quality: string;
  readonly transitions: JsonValue;
  readonly audioSegment: JsonValue;
  readonly browserIdentity: string;
  readonly rendererIdentity: string;
  readonly ffmpegVersion: string;
  readonly os: string;
  readonly architecture: string;
  readonly gpu: string;
  readonly locale: string;
  readonly timezone: string;
  readonly seeds: Readonly<Record<string, string>>;
  readonly lockfileHash: string;
  readonly approvedNetworkHashes: readonly string[];
}

export interface RenderPreflightFinding {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly blocking: boolean;
  readonly message: string;
  readonly affectedIds: readonly string[];
  readonly repairHint: string;
  readonly evidenceHashes: readonly string[];
}

export interface RenderPathDecision {
  readonly entityId: string;
  readonly path: RenderExecutionPath;
  readonly owner: "remotion" | "hyperframes" | "shared" | "caption" | "bridge";
  readonly capabilityIdentity: string;
  readonly approximation: string | null;
  readonly fallback: string | null;
  readonly findings: readonly RenderPreflightFinding[];
}

export interface RenderPlan {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly dag: RenderDag;
  readonly dependencyManifest: RenderDependencyManifest;
  readonly environment: RenderEnvironmentIdentity;
  readonly decisions: readonly RenderPathDecision[];
  readonly findings: readonly RenderPreflightFinding[];
  readonly executable: boolean;
  readonly identityHash: string;
}

export interface RenderArtifactMetadata {
  readonly schemaVersion: "1.0.0";
  readonly cacheKey: string;
  readonly artifactHash: string;
  readonly byteLength: number;
  readonly descriptor: RenderArtifactDescriptor;
  readonly dependencyManifestHash: string;
  readonly strictEnvironmentFingerprint: string;
  readonly portableEnvironmentContractHash: string | null;
  readonly producerNodeId: string;
  readonly createdAt: string;
  readonly validatedAt: string;
}

export interface RenderProgressUpdate {
  readonly nodeId: string;
  readonly stage: string;
  readonly progress: number;
  readonly completedFrames: string | null;
  readonly totalFrames: string | null;
  readonly cache: "hit" | "miss" | "bypass" | null;
  readonly engine: string | null;
  readonly clipId: string | null;
  readonly estimatedRemainingMs: number | null;
}
