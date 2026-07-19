import type { RenderDag, RenderProgressUpdate } from "./contracts.js";

export interface RenderProgressSnapshot {
  readonly progress: number;
  readonly completedNodes: number;
  readonly totalNodes: number;
  readonly activeNodeIds: readonly string[];
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly estimatedRemainingMs: number | null;
  readonly estimateLabel: "estimate" | null;
  readonly complete: boolean;
}

export class RenderProgressAggregator {
  readonly #dag: RenderDag;
  readonly #updates = new Map<string, RenderProgressUpdate>();
  readonly #validated = new Set<string>();

  constructor(dag: RenderDag) {
    this.#dag = dag;
  }

  update(value: RenderProgressUpdate): RenderProgressSnapshot {
    if (!this.#dag.nodes.some((node) => node.id === value.nodeId)) {
      throw new Error(`Progress references unknown render node ${value.nodeId}.`);
    }
    if (!Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1) {
      throw new Error("Render node progress must be normalized.");
    }
    if (value.estimatedRemainingMs !== null && value.estimatedRemainingMs < 0) {
      throw new Error("Render progress estimate cannot be negative.");
    }
    this.#updates.set(value.nodeId, value);
    return this.snapshot();
  }

  markArtifactsValidated(nodeId: string): RenderProgressSnapshot {
    const update = this.#updates.get(nodeId);
    if (update?.progress !== 1) throw new Error("A render node cannot validate before execution finishes.");
    this.#validated.add(nodeId);
    return this.snapshot();
  }

  snapshot(): RenderProgressSnapshot {
    const updates = [...this.#updates.values()];
    const totalNodes = this.#dag.nodes.length;
    const progress =
      totalNodes === 0
        ? 0
        : this.#dag.nodes.reduce((sum, node) => sum + (this.#updates.get(node.id)?.progress ?? 0), 0) /
          totalNodes;
    const estimates = updates.flatMap((update) =>
      update.estimatedRemainingMs === null ? [] : [update.estimatedRemainingMs],
    );
    return {
      progress: this.#validated.size === totalNodes ? 1 : Math.min(progress, 0.999_999),
      completedNodes: this.#validated.size,
      totalNodes,
      activeNodeIds: updates
        .filter((update) => update.progress < 1)
        .map((update) => update.nodeId)
        .sort(),
      cacheHits: updates.filter((update) => update.cache === "hit").length,
      cacheMisses: updates.filter((update) => update.cache === "miss").length,
      estimatedRemainingMs: estimates.length === 0 ? null : Math.max(...estimates),
      estimateLabel: estimates.length === 0 ? null : "estimate",
      complete: this.#validated.size === totalNodes,
    };
  }
}
