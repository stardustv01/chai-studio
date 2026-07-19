import type { RenderDag, RenderDagNode } from "./contracts.js";
import { validateRenderDag } from "./dag.js";
import type {
  RenderNodeExecutionContext,
  RenderNodeExecutionResult,
  RenderNodeExecutor,
} from "./execution.js";

export interface RenderScheduleResult {
  readonly results: ReadonlyMap<string, RenderNodeExecutionResult>;
  readonly executionOrder: readonly string[];
}

export interface RenderSchedulerLimits {
  readonly maximumConcurrency: number;
  readonly trustedConcurrency: number;
  readonly untrustedConcurrency: number;
  readonly gpuSlots: number;
}

export class RenderPauseController {
  #paused = false;
  #waiters: (() => void)[] = [];

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
    for (const resolve of this.#waiters.splice(0)) {
      resolve();
    }
  }

  async wait(signal: AbortSignal): Promise<void> {
    if (!this.#paused) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        reject(new DOMException("Paused render was cancelled.", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.#waiters.push(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
    });
  }
}

export class RenderDagScheduler {
  readonly #executors: ReadonlyMap<RenderDagNode["kind"], RenderNodeExecutor>;
  readonly #limits: RenderSchedulerLimits;

  constructor(executors: readonly RenderNodeExecutor[], limits: number | RenderSchedulerLimits) {
    const normalized =
      typeof limits === "number"
        ? { maximumConcurrency: limits, trustedConcurrency: limits, untrustedConcurrency: 1, gpuSlots: 1 }
        : limits;
    for (const value of Object.values(normalized)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 64) {
        throw new Error("Render scheduler resource limit is outside bounded limits.");
      }
    }
    this.#executors = new Map(executors.map((executor) => [executor.kind, executor]));
    this.#limits = normalized;
  }

  async execute(
    dag: RenderDag,
    contextFor: (
      node: RenderDagNode,
      results: ReadonlyMap<string, RenderNodeExecutionResult>,
    ) => RenderNodeExecutionContext,
    options: Readonly<{
      resumeResults?: ReadonlyMap<string, RenderNodeExecutionResult>;
      pause?: RenderPauseController;
    }> = {},
  ): Promise<RenderScheduleResult> {
    const ordered = validateRenderDag(dag);
    const pending = new Map(ordered.map((node) => [node.id, node]));
    const results = new Map<string, RenderNodeExecutionResult>(options.resumeResults ?? []);
    for (const [nodeId, result] of results) {
      const node = pending.get(nodeId);
      if (node === undefined || !node.retryPolicy.resumable || result.nodeId !== nodeId) {
        throw new Error(`Render resume result ${nodeId} is not valid for this DAG.`);
      }
      pending.delete(nodeId);
    }
    const executionOrder: string[] = [];
    while (pending.size > 0) {
      const candidates = [...pending.values()].filter((node) =>
        node.dependsOn.every((dependency) => results.has(dependency)),
      );
      const ready: RenderDagNode[] = [];
      let trusted = 0;
      let untrusted = 0;
      let gpu = 0;
      for (const node of candidates) {
        const nextTrusted = trusted + (node.trustClass === "trusted-authored" ? 1 : 0);
        const nextUntrusted = untrusted + (node.trustClass === "imported-untrusted" ? 1 : 0);
        const nextGpu = gpu + (node.resources.gpu === "none" ? 0 : 1);
        const exclusiveConflict =
          node.resources.gpu === "exclusive"
            ? gpu > 0
            : ready.some((item) => item.resources.gpu === "exclusive");
        if (
          ready.length >= this.#limits.maximumConcurrency ||
          nextTrusted > this.#limits.trustedConcurrency ||
          nextUntrusted > this.#limits.untrustedConcurrency ||
          nextGpu > this.#limits.gpuSlots ||
          exclusiveConflict
        ) {
          continue;
        }
        ready.push(node);
        trusted = nextTrusted;
        untrusted = nextUntrusted;
        gpu = nextGpu;
      }
      if (ready.length === 0) throw new Error("Render scheduler reached an impossible dependency state.");
      const settled = await Promise.all(
        ready.map(async (node) => {
          const executor = this.#executors.get(node.kind);
          if (executor === undefined) throw new Error(`No render executor is registered for ${node.kind}.`);
          const context = contextFor(node, results);
          if (context.signal.aborted) throw new DOMException("Render DAG was cancelled.", "AbortError");
          await options.pause?.wait(context.signal);
          for (let attempt = 1; attempt <= node.retryPolicy.maxAttempts; attempt += 1) {
            try {
              const result = await executor.execute(node, context);
              if (result.nodeId !== node.id)
                throw new Error("Render executor returned the wrong node identity.");
              return { node, result };
            } catch (cause) {
              throwIfAborted(context.signal);
              if (attempt >= node.retryPolicy.maxAttempts) throw cause;
            }
          }
          throw new Error(`Render node ${node.id} exhausted its retry boundary.`);
        }),
      );
      for (const { node, result } of settled) {
        pending.delete(node.id);
        results.set(node.id, result);
        executionOrder.push(node.id);
      }
    }
    return { results, executionOrder };
  }
}

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException("Render DAG was cancelled.", "AbortError");
};
