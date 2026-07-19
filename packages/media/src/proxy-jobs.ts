import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import type { GeneratedProxyArtifact } from "./proxy-manager.js";

export type ProxyJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ProxyJobSnapshot {
  readonly id: string;
  readonly status: ProxyJobStatus;
  readonly sourceAssetId: string;
  readonly profileId: string;
  readonly error: string | null;
}

interface ProxyJobEntry {
  snapshot: ProxyJobSnapshot;
  readonly controller: AbortController;
  completion: Promise<GeneratedProxyArtifact | null>;
  artifact: GeneratedProxyArtifact | null;
}

export class ProxyJobController {
  readonly #jobs = new Map<string, ProxyJobEntry>();

  enqueue(input: {
    readonly id: string;
    readonly sourceAssetId: string;
    readonly profileId: string;
    readonly task: (signal: AbortSignal) => Promise<GeneratedProxyArtifact>;
  }): ProxyJobSnapshot {
    if (this.#jobs.has(input.id))
      throw jobError("media.proxy.job-duplicate", `Proxy job already exists: ${input.id}.`);
    const controller = new AbortController();
    const queued: ProxyJobSnapshot = {
      id: input.id,
      status: "queued",
      sourceAssetId: input.sourceAssetId,
      profileId: input.profileId,
      error: null,
    };
    const entry: ProxyJobEntry = {
      snapshot: queued,
      controller,
      artifact: null,
      completion: Promise.resolve(null),
    };
    entry.completion = Promise.resolve()
      .then(async () => {
        if (signalIsAborted(controller.signal)) return null;
        entry.snapshot = { ...entry.snapshot, status: "running" };
        const artifact = await input.task(controller.signal);
        if (signalIsAborted(controller.signal)) return null;
        entry.artifact = artifact;
        entry.snapshot = { ...entry.snapshot, status: "completed" };
        return artifact;
      })
      .catch((error: unknown) => {
        entry.snapshot = {
          ...entry.snapshot,
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: controller.signal.aborted ? null : errorMessage(error),
        };
        return null;
      });
    this.#jobs.set(input.id, entry);
    return queued;
  }

  get(jobId: string): ProxyJobSnapshot {
    return { ...this.#require(jobId).snapshot };
  }

  list(): readonly ProxyJobSnapshot[] {
    return [...this.#jobs.values()]
      .map((entry) => ({ ...entry.snapshot }))
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
  }

  cancel(jobId: string): ProxyJobSnapshot {
    const entry = this.#require(jobId);
    if (entry.snapshot.status === "completed" || entry.snapshot.status === "failed")
      return { ...entry.snapshot };
    entry.controller.abort();
    entry.snapshot = { ...entry.snapshot, status: "cancelled", error: null };
    return { ...entry.snapshot };
  }

  async wait(jobId: string): Promise<GeneratedProxyArtifact> {
    const entry = this.#require(jobId);
    const artifact = await entry.completion;
    if (artifact !== null) return artifact;
    throw jobError(
      entry.snapshot.status === "cancelled" ? "media.proxy.job-cancelled" : "media.proxy.job-failed",
      entry.snapshot.error ?? `Proxy job ${jobId} was cancelled.`,
    );
  }

  #require(jobId: string): ProxyJobEntry {
    const entry = this.#jobs.get(jobId);
    if (entry === undefined) throw jobError("media.proxy.job-unknown", `Unknown proxy job: ${jobId}.`);
    return entry;
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Proxy job failed with an unknown error.";

const signalIsAborted = (signal: AbortSignal): boolean => signal.aborted;

const jobError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "media",
    code,
    correlationId: createCorrelationId(),
    stage: "proxy-background-job",
    message,
    repairHint: "Inspect the job status, repair the source/profile, and enqueue a new stable job ID.",
  });
