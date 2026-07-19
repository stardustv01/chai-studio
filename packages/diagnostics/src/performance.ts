export const performanceMetricNames = [
  "cold-start",
  "project-open",
  "snapshot-load",
  "schema-validation",
  "derived-index-rebuild",
  "revision-diff",
  "seek",
  "frame-step",
  "play-drift",
  "timeline-interaction",
  "timeline-search",
  "inspector-update",
  "exact-capture",
  "proxy-generation",
  "render-throughput",
  "memory-rss",
  "gpu-resident-memory",
  "disk-throughput",
  "cache-hit-rate",
] as const;

export type PerformanceMetricName = (typeof performanceMetricNames)[number];
export type PerformanceUnit = "milliseconds" | "frames-per-second" | "bytes" | "ratio" | "count";
export type ProjectClassId =
  | "small"
  | "medium"
  | "long"
  | "hundreds-of-clips"
  | "heavy-webgl"
  | "captions"
  | "audio"
  | "mixed-engine-bridges";

export interface SupportedHardwareClass {
  readonly id: string;
  readonly platform: "darwin";
  readonly architecture: "arm64";
  readonly cpuModel: string;
  readonly logicalCpuCount: number;
  readonly memoryGiB: number;
  readonly gpuClass: string;
  readonly osRelease: string;
}

export interface BenchmarkFixtureDefinition {
  readonly id: string;
  readonly projectClass: ProjectClassId;
  readonly durationFrames: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly captionCount: number;
  readonly audioClipCount: number;
  readonly nativeLayerCount: number;
  readonly webglLayerCount: number;
  readonly bridgeCount: number;
  readonly sourceIdentity: string;
}

export interface PerformanceSampleV1 {
  readonly schemaVersion: "1.0.0";
  readonly metric: PerformanceMetricName;
  readonly unit: PerformanceUnit;
  readonly value: number;
  readonly hardwareClassId: string;
  readonly fixtureId: string;
  readonly cold: boolean;
  readonly observedAt: string;
  readonly localOnly: true;
  readonly detail: Readonly<Record<string, number | string | boolean>>;
}

export interface PerformanceBudget {
  readonly metric: PerformanceMetricName;
  readonly unit: PerformanceUnit;
  readonly hardwareClassId: string;
  readonly projectClass: ProjectClassId;
  readonly direction: "maximum" | "minimum";
  readonly p95: number;
  readonly maximumRegressionRatio: number;
  readonly minimumSamples: number;
}

export interface PerformanceMetricSummary {
  readonly metric: PerformanceMetricName;
  readonly unit: PerformanceUnit;
  readonly sampleCount: number;
  readonly minimum: number;
  readonly p50: number;
  readonly p95: number;
  readonly maximum: number;
}

export interface PerformanceBudgetResult {
  readonly budget: PerformanceBudget;
  readonly fixtureId: string;
  readonly passed: boolean;
  readonly reason: "passed" | "insufficient-samples" | "budget-exceeded";
  readonly summary: PerformanceMetricSummary | null;
}

export class LocalPerformanceLedger {
  readonly #samples: PerformanceSampleV1[] = [];
  readonly #maximumSamples: number;

  constructor(maximumSamples = 2_000) {
    if (!Number.isSafeInteger(maximumSamples) || maximumSamples < 1) {
      throw new Error("Performance ledger maximum samples must be a positive safe integer.");
    }
    this.#maximumSamples = maximumSamples;
  }

  record(sample: PerformanceSampleV1): void {
    assertPerformanceSample(sample);
    this.#samples.push(structuredClone(sample));
    if (this.#samples.length > this.#maximumSamples) {
      this.#samples.splice(0, this.#samples.length - this.#maximumSamples);
    }
  }

  snapshot(): readonly PerformanceSampleV1[] {
    return structuredClone(this.#samples);
  }

  clear(): void {
    this.#samples.splice(0, this.#samples.length);
  }
}

export class CachePerformanceLedger {
  #hits = 0;
  #misses = 0;
  #lookupDurationMs = 0;

  recordLookup(hit: boolean, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error("Cache lookup duration must be finite and non-negative.");
    }
    if (hit) this.#hits += 1;
    else this.#misses += 1;
    this.#lookupDurationMs += durationMs;
  }

  snapshot(): Readonly<{
    hits: number;
    misses: number;
    total: number;
    hitRate: number;
    lookupDurationMs: number;
  }> {
    const total = this.#hits + this.#misses;
    return {
      hits: this.#hits,
      misses: this.#misses,
      total,
      hitRate: total === 0 ? 0 : this.#hits / total,
      lookupDurationMs: this.#lookupDurationMs,
    };
  }
}

export const summarizePerformanceSamples = (
  metric: PerformanceMetricName,
  samples: readonly PerformanceSampleV1[],
): PerformanceMetricSummary | null => {
  const matching = samples.filter((sample) => sample.metric === metric);
  if (matching.length === 0) return null;
  const unit = matching[0]?.unit;
  if (unit === undefined || matching.some((sample) => sample.unit !== unit)) {
    throw new Error(`Performance metric ${metric} mixes incompatible units.`);
  }
  const values = matching.map((sample) => sample.value).sort((left, right) => left - right);
  return {
    metric,
    unit,
    sampleCount: values.length,
    minimum: requireNumber(values[0]),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: requireNumber(values.at(-1)),
  };
};

export const evaluatePerformanceBudget = (
  budget: PerformanceBudget,
  fixture: BenchmarkFixtureDefinition,
  samples: readonly PerformanceSampleV1[],
): PerformanceBudgetResult => {
  if (fixture.projectClass !== budget.projectClass) {
    throw new Error(`Fixture ${fixture.id} does not match budget class ${budget.projectClass}.`);
  }
  const matching = samples.filter(
    (sample) =>
      sample.metric === budget.metric &&
      sample.unit === budget.unit &&
      sample.hardwareClassId === budget.hardwareClassId &&
      sample.fixtureId === fixture.id,
  );
  const summary = summarizePerformanceSamples(budget.metric, matching);
  if (summary === null || summary.sampleCount < budget.minimumSamples) {
    return { budget, fixtureId: fixture.id, passed: false, reason: "insufficient-samples", summary };
  }
  const passed = budget.direction === "maximum" ? summary.p95 <= budget.p95 : summary.p95 >= budget.p95;
  return {
    budget,
    fixtureId: fixture.id,
    passed,
    reason: passed ? "passed" : "budget-exceeded",
    summary,
  };
};

export const comparePerformanceRegression = (
  budget: PerformanceBudget,
  baselineP95: number,
  candidateP95: number,
): Readonly<{ passed: boolean; ratio: number; reason: string }> => {
  if (![baselineP95, candidateP95].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Performance regression values must be finite and non-negative.");
  }
  const ratio =
    baselineP95 === 0
      ? candidateP95 === 0
        ? 1
        : Number.POSITIVE_INFINITY
      : budget.direction === "maximum"
        ? candidateP95 / baselineP95
        : baselineP95 / Math.max(candidateP95, Number.EPSILON);
  const passed = ratio <= budget.maximumRegressionRatio;
  return {
    passed,
    ratio,
    reason: passed
      ? "Candidate remains within the frozen regression threshold."
      : "Candidate exceeds the frozen regression threshold and requires correction or explicit support removal.",
  };
};

const assertPerformanceSample = (sample: PerformanceSampleV1): void => {
  if (!performanceMetricNames.includes(sample.metric)) throw new Error("Unknown performance metric.");
  if (!Number.isFinite(sample.value) || sample.value < 0) {
    throw new Error("Performance sample value must be finite and non-negative.");
  }
  if (Number.isNaN(Date.parse(sample.observedAt)))
    throw new Error("Performance sample timestamp is invalid.");
};

const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return requireNumber(sorted[index]);
};

const requireNumber = (value: number | undefined): number => {
  if (value === undefined) throw new Error("Performance summary requires at least one sample.");
  return value;
};
