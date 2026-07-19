export const requiredSoakScenarios = [
  "long-playback",
  "repeated-seek",
  "hundreds-of-clips",
  "long-render",
  "cancel-retry",
  "low-disk",
  "corrupt-media",
  "browser-restart",
  "cache-cleanup",
] as const;

export type SoakScenario = (typeof requiredSoakScenarios)[number];

export interface SoakCheckpoint {
  readonly iteration: number;
  readonly memoryMiB: number;
  readonly cacheEntries: number;
  readonly openHandles: number;
  readonly authoritativeStateHash: string;
  readonly corruptionDetected: boolean;
}

export interface SoakScenarioResult {
  readonly scenario: SoakScenario;
  readonly passed: boolean;
  readonly checkpointCount: number;
  readonly memoryGrowthMiB: number;
  readonly maximumCacheEntries: number;
  readonly maximumOpenHandles: number;
  readonly stateHashStable: boolean;
  readonly boundedResources: boolean;
  readonly noCorruption: boolean;
}

export const evaluateSoakScenario = (input: {
  readonly scenario: SoakScenario;
  readonly checkpoints: readonly SoakCheckpoint[];
  readonly maximumMemoryGrowthMiB: number;
  readonly maximumCacheEntries: number;
  readonly maximumOpenHandles: number;
}): SoakScenarioResult => {
  if (input.checkpoints.length < 2) throw new Error("Soak evaluation requires at least two checkpoints.");
  const ordered = [...input.checkpoints].sort((left, right) => left.iteration - right.iteration);
  if (ordered.some((checkpoint, index) => checkpoint.iteration !== index)) {
    throw new Error("Soak checkpoints must cover contiguous zero-based iterations.");
  }
  const first = requireCheckpoint(ordered[0]);
  const last = requireCheckpoint(ordered.at(-1));
  const memoryGrowthMiB = last.memoryMiB - first.memoryMiB;
  const maximumCacheEntries = Math.max(...ordered.map((checkpoint) => checkpoint.cacheEntries));
  const maximumOpenHandles = Math.max(...ordered.map((checkpoint) => checkpoint.openHandles));
  const stateHashStable = ordered.every(
    (checkpoint) => checkpoint.authoritativeStateHash === first.authoritativeStateHash,
  );
  const boundedResources =
    memoryGrowthMiB <= input.maximumMemoryGrowthMiB &&
    maximumCacheEntries <= input.maximumCacheEntries &&
    maximumOpenHandles <= input.maximumOpenHandles;
  const noCorruption = ordered.every((checkpoint) => !checkpoint.corruptionDetected);
  return {
    scenario: input.scenario,
    passed: stateHashStable && boundedResources && noCorruption,
    checkpointCount: ordered.length,
    memoryGrowthMiB,
    maximumCacheEntries,
    maximumOpenHandles,
    stateHashStable,
    boundedResources,
    noCorruption,
  };
};

export const assertCompleteSoakCoverage = (results: readonly SoakScenarioResult[]): void => {
  const byScenario = new Map(results.map((result) => [result.scenario, result]));
  const missing = requiredSoakScenarios.filter((scenario) => !byScenario.has(scenario));
  const failed = results.filter((result) => !result.passed).map((result) => result.scenario);
  if (missing.length > 0 || failed.length > 0) {
    throw new Error(
      `Soak matrix incomplete or failed. Missing: ${missing.join(",")}; failed: ${failed.join(",")}.`,
    );
  }
};

const requireCheckpoint = (checkpoint: SoakCheckpoint | undefined): SoakCheckpoint => {
  if (checkpoint === undefined) throw new Error("Soak checkpoint is missing.");
  return checkpoint;
};
