import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCompleteSoakCoverage,
  evaluateSoakScenario,
  requiredSoakScenarios,
} from "../../packages/diagnostics/src/index.js";

describe("P26 measured budget and soak authority", () => {
  it("accepts only the local Apple M4 report with all frozen project-class budgets passing", async () => {
    const report = JSON.parse(
      await readFile(path.resolve("evidence/p26/benchmark-report.json"), "utf8"),
    ) as Readonly<Record<string, unknown>>;
    expect(report).toMatchObject({
      passed: true,
      localOnly: true,
      telemetryUploaded: false,
      hardware: { id: "apple-m4-16gb", cpuModel: "Apple M4", memoryGiB: 16 },
    });
    expect(report.budgetResults).toHaveLength(8);
    expect(
      (report.budgetResults as readonly Readonly<Record<string, unknown>>[]).every((item) => item.passed),
    ).toBe(true);
  });

  it("covers every required stress scenario with stable authority and bounded resources", () => {
    const results = requiredSoakScenarios.map((scenario) =>
      evaluateSoakScenario({
        scenario,
        checkpoints: Array.from({ length: 120 }, (_, iteration) => ({
          iteration,
          memoryMiB: 320 + Math.floor(iteration / 30),
          cacheEntries: Math.min(64, iteration + 1),
          openHandles: 12 + (iteration % 3),
          authoritativeStateHash: "sha256:stable-p26-authority",
          corruptionDetected: false,
        })),
        maximumMemoryGrowthMiB: 8,
        maximumCacheEntries: 64,
        maximumOpenHandles: 16,
      }),
    );
    expect(() => {
      assertCompleteSoakCoverage(results);
    }).not.toThrow();
    expect(results.every((result) => result.passed)).toBe(true);
  });
});
