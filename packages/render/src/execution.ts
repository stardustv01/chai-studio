import type {
  RenderArtifactMetadata,
  RenderDagNode,
  RenderEnvironmentIdentity,
  RenderProgressUpdate,
} from "./contracts.js";

export interface RenderNodeExecutionContext {
  readonly projectRoot: string;
  readonly workingDirectory: string;
  readonly environment: RenderEnvironmentIdentity;
  readonly signal: AbortSignal;
  readonly report: (update: RenderProgressUpdate) => void;
  readonly dependencyArtifacts: ReadonlyMap<string, readonly RenderArtifactMetadata[]>;
}

export interface RenderNodeExecutionResult {
  readonly nodeId: string;
  readonly artifacts: readonly RenderArtifactMetadata[];
  readonly logs: readonly string[];
  readonly warnings: readonly string[];
}

export interface RenderNodeExecutor {
  readonly kind: RenderDagNode["kind"];
  execute(node: RenderDagNode, context: RenderNodeExecutionContext): Promise<RenderNodeExecutionResult>;
}

export interface MasterCompositorRequest {
  readonly node: RenderDagNode;
  readonly visualLayers: readonly RenderArtifactMetadata[];
  readonly bridgeLayers: readonly RenderArtifactMetadata[];
  readonly captionLayers: readonly RenderArtifactMetadata[];
  readonly audioArtifact: RenderArtifactMetadata | null;
  readonly outputPath: string;
  readonly signal: AbortSignal;
  readonly report: (progress: number) => void;
}

export interface MasterCompositorResult {
  readonly implementationId: string;
  readonly implementationVersion: string;
  readonly outputPath: string;
  readonly frameCount: string;
  readonly durationSamples: string | null;
  readonly logs: readonly string[];
}

export interface MasterCompositor {
  readonly implementationId: string;
  readonly implementationVersion: string;
  compose(request: MasterCompositorRequest): Promise<MasterCompositorResult>;
}

export const assertVideoAudioAlignment = (input: {
  readonly durationFrames: string;
  readonly fpsNumerator: string;
  readonly fpsDenominator: string;
  readonly audioDurationSamples: string;
  readonly sampleRate: number;
}): void => {
  const frames = BigInt(input.durationFrames);
  const numerator = BigInt(input.fpsNumerator);
  const denominator = BigInt(input.fpsDenominator);
  const samples = BigInt(input.audioDurationSamples);
  if (frames < 1n || numerator < 1n || denominator < 1n || input.sampleRate < 1) {
    throw new Error("Video/audio alignment inputs are invalid.");
  }
  const expectedNumerator = frames * denominator * BigInt(input.sampleRate);
  if (expectedNumerator % numerator !== 0n) {
    throw new Error("Video endpoint does not map to an exact audio sample endpoint.");
  }
  if (samples !== expectedNumerator / numerator) {
    throw new Error("Authoritative audio and video durations do not align exactly.");
  }
};

export interface OutputCandidatePointer {
  readonly schemaVersion: "1.0.0";
  readonly outputId: string;
  readonly sourceRevisionId: string;
  readonly receiptIdentityHash: string;
  readonly artifactHashes: readonly string[];
  readonly lifecycleState: "rendered_unchecked";
  readonly createdAt: string;
}

export const createOutputCandidatePointer = (
  input: Omit<OutputCandidatePointer, "schemaVersion" | "lifecycleState">,
): OutputCandidatePointer => {
  if (
    input.artifactHashes.length === 0 ||
    input.artifactHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))
  ) {
    throw new Error("Output candidate requires validated artifact hashes.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.receiptIdentityHash)) {
    throw new Error("Output candidate receipt identity is invalid.");
  }
  return { schemaVersion: "1.0.0", ...input, lifecycleState: "rendered_unchecked" };
};
