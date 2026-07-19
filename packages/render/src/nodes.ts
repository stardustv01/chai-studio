import type { RenderArtifactDescriptor, RenderDagNode, RenderNodeKind } from "./contracts.js";
import type {
  RenderNodeExecutionContext,
  RenderNodeExecutionResult,
  RenderNodeExecutor,
} from "./execution.js";
import type { ContentAddressedArtifactStore } from "./artifact-store.js";

export type ArtifactProducingNodeKind = Extract<
  RenderNodeKind,
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
>;

export interface ProducedRenderArtifact {
  readonly descriptor: RenderArtifactDescriptor;
  readonly sourcePath: string;
  readonly logs: readonly string[];
  readonly warnings: readonly string[];
}

export type ArtifactNodeHandler = (
  node: RenderDagNode,
  context: RenderNodeExecutionContext,
) => Promise<readonly ProducedRenderArtifact[]>;

export class CachedArtifactNodeExecutor implements RenderNodeExecutor {
  readonly kind: ArtifactProducingNodeKind;
  readonly #store: ContentAddressedArtifactStore;
  readonly #dependencyManifestHash: string;
  readonly #cacheKeyFor: (
    node: RenderDagNode,
    descriptor: RenderArtifactDescriptor,
    context: RenderNodeExecutionContext,
  ) => string;
  readonly #portableContractFor: (
    node: RenderDagNode,
    descriptor: RenderArtifactDescriptor,
    context: RenderNodeExecutionContext,
  ) => string | null;
  readonly #handler: ArtifactNodeHandler;

  constructor(input: {
    readonly kind: ArtifactProducingNodeKind;
    readonly store: ContentAddressedArtifactStore;
    readonly dependencyManifestHash: string;
    readonly cacheKeyFor: (
      node: RenderDagNode,
      descriptor: RenderArtifactDescriptor,
      context: RenderNodeExecutionContext,
    ) => string;
    readonly portableContractFor?: (
      node: RenderDagNode,
      descriptor: RenderArtifactDescriptor,
      context: RenderNodeExecutionContext,
    ) => string | null;
    readonly handler: ArtifactNodeHandler;
  }) {
    this.kind = input.kind;
    this.#store = input.store;
    this.#dependencyManifestHash = input.dependencyManifestHash;
    this.#cacheKeyFor = input.cacheKeyFor;
    this.#portableContractFor = input.portableContractFor ?? (() => null);
    this.#handler = input.handler;
  }

  async execute(
    node: RenderDagNode,
    context: RenderNodeExecutionContext,
  ): Promise<RenderNodeExecutionResult> {
    if (node.kind !== this.kind) throw new Error("Render node executor kind mismatch.");
    const cached = [];
    if (node.cachePolicy !== "never") {
      for (const descriptor of node.expectedOutputs) {
        const hit = await this.#store.lookup({
          cacheKey: this.#cacheKeyFor(node, descriptor, context),
          strictEnvironmentFingerprint: context.environment.strictEnvironmentFingerprint,
          portableEnvironmentContractHash:
            node.cachePolicy === "portable-proven"
              ? this.#portableContractFor(node, descriptor, context)
              : null,
        });
        if (hit.status !== "hit") break;
        cached.push(hit.metadata);
      }
    }
    if (cached.length === node.expectedOutputs.length && cached.length > 0) {
      context.report(progress(node.id, "cache-hit", 1, "hit"));
      return { nodeId: node.id, artifacts: cached, logs: ["Validated cache hit."], warnings: [] };
    }
    context.report(progress(node.id, "rendering", 0, node.cachePolicy === "never" ? "bypass" : "miss"));
    const produced = await this.#handler(node, context);
    if (context.signal.aborted) throw new DOMException("Render node was cancelled.", "AbortError");
    const expectedIds = node.expectedOutputs.map((item) => item.artifactId).sort();
    const producedIds = produced.map((item) => item.descriptor.artifactId).sort();
    if (JSON.stringify(producedIds) !== JSON.stringify(expectedIds)) {
      throw new Error(`Render node ${node.id} produced artifacts outside its declared contract.`);
    }
    const artifacts = await Promise.all(
      produced.map(async (item) => {
        const cacheKey = this.#cacheKeyFor(node, item.descriptor, context);
        return (
          await this.#store.publish({
            cacheKey,
            sourcePath: item.sourcePath,
            descriptor: item.descriptor,
            dependencyManifestHash: this.#dependencyManifestHash,
            strictEnvironmentFingerprint: context.environment.strictEnvironmentFingerprint,
            portableEnvironmentContractHash:
              node.cachePolicy === "portable-proven"
                ? this.#portableContractFor(node, item.descriptor, context)
                : null,
            producerNodeId: node.id,
          })
        ).metadata;
      }),
    );
    context.report(progress(node.id, "validated", 1, node.cachePolicy === "never" ? "bypass" : "miss"));
    return {
      nodeId: node.id,
      artifacts,
      logs: produced.flatMap((item) => item.logs),
      warnings: produced.flatMap((item) => item.warnings),
    };
  }
}

const progress = (nodeId: string, stage: string, value: number, cache: "hit" | "miss" | "bypass") => ({
  nodeId,
  stage,
  progress: value,
  completedFrames: null,
  totalFrames: null,
  cache,
  engine: null,
  clipId: null,
  estimatedRemainingMs: null,
});
