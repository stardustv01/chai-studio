import { randomUUID } from "node:crypto";

export type StudioJobKind =
  "asset.inspect" | "asset.proxy" | "asset.thumbnail" | "asset.waveform" | "render.execute" | "render.qa";
export type StudioJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface StudioJobSnapshot {
  readonly id: string;
  readonly kind: StudioJobKind;
  readonly status: StudioJobStatus;
  readonly progress: number;
  readonly priority: number;
  readonly queueOrder: number;
  readonly label: string;
  readonly stage: string;
  readonly activeEngine: "remotion" | "hyperframes" | "shared" | null;
  readonly cacheHits: number;
  readonly estimateLabel: string | null;
  readonly correlationId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error: string | null;
  readonly result: unknown;
}

export interface StudioJobTaskContext {
  readonly signal: AbortSignal;
  readonly report: (progress: number) => void;
  readonly reportStage: (input: {
    readonly stage: string;
    readonly activeEngine?: StudioJobSnapshot["activeEngine"];
    readonly cacheHits?: number;
    readonly estimateLabel?: string | null;
  }) => void;
}

interface StudioJobEntry {
  snapshot: StudioJobSnapshot;
  readonly controller: AbortController;
  completion: Promise<void>;
}

export class StudioJobRegistry {
  readonly #jobs = new Map<string, StudioJobEntry>();
  readonly #now: () => Date;
  readonly #listeners = new Set<(snapshot: StudioJobSnapshot) => void>();
  #nextQueueOrder = 1;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  enqueue(input: {
    readonly id?: string;
    readonly kind: StudioJobKind;
    readonly correlationId: string;
    readonly projectId: string;
    readonly revisionId: string;
    readonly priority?: number;
    readonly label?: string;
    readonly task: (context: StudioJobTaskContext) => Promise<unknown>;
  }): StudioJobSnapshot {
    const id = input.id ?? `job-${randomUUID()}`;
    if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(id) || this.#jobs.has(id)) {
      throw new Error(`Invalid or duplicate Studio job ID: ${id}.`);
    }
    const controller = new AbortController();
    const timestamp = this.#now().toISOString();
    const queued: StudioJobSnapshot = {
      id,
      kind: input.kind,
      status: "queued",
      progress: 0,
      priority: assertPriority(input.priority ?? 0),
      queueOrder: this.#nextQueueOrder++,
      label: assertLabel(input.label ?? input.kind),
      stage: "Queued",
      activeEngine: null,
      cacheHits: 0,
      estimateLabel: null,
      correlationId: input.correlationId,
      projectId: input.projectId,
      revisionId: input.revisionId,
      createdAt: timestamp,
      updatedAt: timestamp,
      error: null,
      result: null,
    };
    const entry: StudioJobEntry = {
      snapshot: queued,
      controller,
      completion: Promise.resolve(),
    };
    entry.completion = Promise.resolve()
      .then(async () => {
        if (signalIsAborted(controller.signal)) return;
        this.#update(entry, { status: "running", progress: 0 });
        const result = await input.task({
          signal: controller.signal,
          report: (progress) => {
            if (!controller.signal.aborted) this.#update(entry, { progress: assertProgress(progress) });
          },
          reportStage: (stage) => {
            if (!controller.signal.aborted) {
              this.#update(entry, {
                stage: assertLabel(stage.stage),
                ...(stage.activeEngine === undefined ? {} : { activeEngine: stage.activeEngine }),
                ...(stage.cacheHits === undefined ? {} : { cacheHits: assertCount(stage.cacheHits) }),
                ...(stage.estimateLabel === undefined
                  ? {}
                  : {
                      estimateLabel: stage.estimateLabel === null ? null : assertLabel(stage.estimateLabel),
                    }),
              });
            }
          },
        });
        if (controller.signal.aborted) return;
        this.#update(entry, { status: "completed", progress: 1, result });
      })
      .catch((error: unknown) => {
        this.#update(entry, {
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: controller.signal.aborted ? null : errorMessage(error),
        });
      });
    this.#jobs.set(id, entry);
    this.#emit(queued);
    return queued;
  }

  get(id: string): StudioJobSnapshot {
    return structuredClone(this.#require(id).snapshot);
  }

  list(): readonly StudioJobSnapshot[] {
    return [...this.#jobs.values()]
      .map((entry) => structuredClone(entry.snapshot))
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.queueOrder - right.queueOrder ||
          left.id.localeCompare(right.id, "en"),
      );
  }

  cancel(id: string): StudioJobSnapshot {
    const entry = this.#require(id);
    if (entry.snapshot.status === "queued" || entry.snapshot.status === "running") {
      entry.controller.abort();
      this.#update(entry, { status: "cancelled", error: null });
    }
    return structuredClone(entry.snapshot);
  }

  reprioritize(id: string, priority: number): StudioJobSnapshot {
    const entry = this.#require(id);
    if (entry.snapshot.status !== "queued") throw new Error("Only queued Studio jobs can be reprioritized.");
    this.#update(entry, { priority: assertPriority(priority) });
    return structuredClone(entry.snapshot);
  }

  clearCompleted(): number {
    let removed = 0;
    for (const [id, entry] of this.#jobs) {
      if (entry.snapshot.status === "completed" || entry.snapshot.status === "cancelled") {
        this.#jobs.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async wait(id: string): Promise<StudioJobSnapshot> {
    const entry = this.#require(id);
    await entry.completion;
    return structuredClone(entry.snapshot);
  }

  subscribe(listener: (snapshot: StudioJobSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #require(id: string): StudioJobEntry {
    const entry = this.#jobs.get(id);
    if (entry === undefined) throw new Error(`Unknown Studio job ID: ${id}.`);
    return entry;
  }

  #update(entry: StudioJobEntry, patch: Partial<StudioJobSnapshot>): void {
    entry.snapshot = { ...entry.snapshot, ...patch, updatedAt: this.#now().toISOString() };
    this.#emit(entry.snapshot);
  }

  #emit(snapshot: StudioJobSnapshot): void {
    for (const listener of this.#listeners) listener(structuredClone(snapshot));
  }
}

const assertProgress = (value: number): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Job progress must be 0..1.");
  return value;
};

const assertPriority = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < -100 || value > 100) {
    throw new Error("Job priority must be an integer from -100 through 100.");
  }
  return value;
};

const assertCount = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Job cache hits must be non-negative.");
  return value;
};

const assertLabel = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) throw new Error("Job labels must be bounded.");
  return normalized;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Job failed with an unknown error.";

const signalIsAborted = (signal: AbortSignal): boolean => signal.aborted;
