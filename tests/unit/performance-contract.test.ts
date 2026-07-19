import { describe, expect, it } from "vitest";
import {
  CachePerformanceLedger,
  comparePerformanceRegression,
  evaluatePerformanceBudget,
  LocalPerformanceLedger,
  summarizePerformanceSamples,
  type BenchmarkFixtureDefinition,
  type PerformanceBudget,
  type PerformanceSampleV1,
} from "../../packages/diagnostics/src/index.js";

const fixture: BenchmarkFixtureDefinition = {
  id: "perf-small-test-v1",
  projectClass: "small",
  durationFrames: 1_800,
  trackCount: 3,
  clipCount: 24,
  captionCount: 12,
  audioClipCount: 4,
  nativeLayerCount: 2,
  webglLayerCount: 0,
  bridgeCount: 1,
  sourceIdentity: "fixture-source-test-v1",
};

const budget: PerformanceBudget = {
  metric: "derived-index-rebuild",
  unit: "milliseconds",
  hardwareClassId: "apple-m4-16gb",
  projectClass: "small",
  direction: "maximum",
  p95: 10,
  maximumRegressionRatio: 1.15,
  minimumSamples: 5,
};

describe("P26 local performance contract", () => {
  it("keeps a bounded local-only sample ledger", () => {
    const ledger = new LocalPerformanceLedger(2);
    ledger.record(sample(1));
    ledger.record(sample(2));
    ledger.record(sample(3));
    expect(ledger.snapshot().map((item) => item.value)).toEqual([2, 3]);
    ledger.clear();
    expect(ledger.snapshot()).toEqual([]);
  });

  it("summarizes deterministic percentiles and enforces a class-specific budget", () => {
    const samples = [1, 2, 3, 4, 5].map(sample);
    expect(summarizePerformanceSamples("derived-index-rebuild", samples)).toMatchObject({
      sampleCount: 5,
      minimum: 1,
      p50: 3,
      p95: 5,
      maximum: 5,
    });
    expect(evaluatePerformanceBudget(budget, fixture, samples)).toMatchObject({
      passed: true,
      reason: "passed",
      fixtureId: fixture.id,
    });
  });

  it("blocks material regressions unless support is explicitly changed", () => {
    expect(comparePerformanceRegression(budget, 10, 11)).toMatchObject({ passed: true, ratio: 1.1 });
    expect(comparePerformanceRegression(budget, 10, 12)).toMatchObject({ passed: false, ratio: 1.2 });
  });

  it("reports cache hit rate without treating a hit as correctness evidence", () => {
    const ledger = new CachePerformanceLedger();
    ledger.recordLookup(true, 1.5);
    ledger.recordLookup(false, 2.5);
    expect(ledger.snapshot()).toEqual({ hits: 1, misses: 1, total: 2, hitRate: 0.5, lookupDurationMs: 4 });
  });
});

const sample = (value: number): PerformanceSampleV1 => ({
  schemaVersion: "1.0.0",
  metric: "derived-index-rebuild",
  unit: "milliseconds",
  value,
  hardwareClassId: "apple-m4-16gb",
  fixtureId: fixture.id,
  cold: value === 1,
  observedAt: "2026-07-16T00:00:00.000Z",
  localOnly: true,
  detail: { clipCount: fixture.clipCount },
});
