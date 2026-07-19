import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P26.01",
    "fixtures/performance/project-classes.json",
    [
      "apple-m4-16gb",
      "small",
      "medium",
      "long",
      "hundreds-of-clips",
      "heavy-webgl",
      "captions",
      "audio",
      "mixed-engine-bridges",
    ],
  ],
  [
    "P26.02",
    "packages/diagnostics/src/performance.ts",
    [
      "cold-start",
      "project-open",
      "seek",
      "frame-step",
      "play-drift",
      "timeline-interaction",
      "exact-capture",
      "proxy-generation",
      "render-throughput",
      "memory-rss",
      "gpu-resident-memory",
      "disk-throughput",
      "cache-hit-rate",
      "localOnly: true",
    ],
  ],
  [
    "P26.02",
    "apps/studio-web/src/use-studio-runtime.ts",
    ["project-open", "exact-capture", "frame-step", "play-drift", "timeline-interaction"],
  ],
  [
    "P26.03",
    "packages/timeline/src/derived-indexes.ts",
    ["TimelineDerivedIndexCache", "WeakMap", "hitRate", "buildTimelineDerivedIndexes"],
  ],
  ["P26.03", "packages/timeline/src/diff.ts", ["before === after", "if (before === after) return;"]],
  [
    "P26.04",
    "apps/studio-web/src/timeline-editor.tsx",
    [
      "firstVisibleTrack",
      "lastVisibleTrack",
      "visibleTracks",
      "useMemo",
      "Only visible track rows are mounted",
    ],
  ],
  [
    "P26.05-P26.07",
    "packages/preview/src/degradation.ts",
    [
      "report-dropped-frames",
      "lower-preview-quality",
      "disable-expensive-effects",
      "render-preview-range",
      "framePerfectRealtimeClaimed: false",
      "reversible: true",
    ],
  ],
  [
    "P26.06,P26.11",
    "packages/diagnostics/src/performance.ts",
    ["CachePerformanceLedger", "evaluatePerformanceBudget", "comparePerformanceRegression"],
  ],
  [
    "P26.08",
    "apps/studio-web/src/shortcut-profile.ts",
    [
      "disable-conflicts",
      "conflictsForProfile",
      "exportShortcutProfile",
      "importShortcutProfile",
      "defaultShortcutProfile",
    ],
  ],
  [
    "P26.09",
    "apps/studio-web/src/accessibility.ts",
    ["highContrast", "reducedMotion", "textScale", "screenReaderSummaries"],
  ],
  [
    "P26.10",
    "packages/diagnostics/src/stress.ts",
    [
      "long-playback",
      "repeated-seek",
      "hundreds-of-clips",
      "long-render",
      "cancel-retry",
      "low-disk",
      "corrupt-media",
      "browser-restart",
      "cache-cleanup",
      "assertCompleteSoakCoverage",
    ],
  ],
  [
    "P26.11",
    "fixtures/performance/budgets.json",
    ["maximumRegressionRatio", "minimumSamples", "derived-index-rebuild", "apple-m4-16gb"],
  ],
  [
    "P26.01-P26.11",
    "docs/PERFORMANCE_ACCESSIBILITY.md",
    ["Local measurement", "Optimization boundaries", "Honest degradation", "Keyboard and accessibility"],
  ],
  [
    "P26.07-P26.09",
    "tests/e2e/performance-accessibility.spec.ts",
    ["not frame-perfect real time", "High contrast", "Reduced motion", "Shortcut conflicts"],
  ],
  [
    "P26.01-P26.11",
    "tests/integration/performance-soak-budget.test.ts",
    ["120", "stable authority", "bounded resources", "every required stress scenario"],
  ],
];

const results = [];
for (const [task, file, symbols] of checks) {
  let content = "";
  let exists = true;
  try {
    content = await readFile(path.join(root, file), "utf8");
  } catch {
    exists = false;
  }
  const missingSymbols = symbols.filter((symbol) => !content.includes(symbol));
  results.push({ task, file, passed: exists && missingSymbols.length === 0, exists, missingSymbols });
}

for (const file of [
  "tests/e2e/studio-visual.spec.ts-snapshots/p26-honest-degradation-darwin.png",
  "tests/e2e/studio-visual.spec.ts-snapshots/p26-accessibility-diagnostics-darwin.png",
  "tests/e2e/studio-visual.spec.ts-snapshots/p26-shortcut-editor-darwin.png",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P26.07-P26.09", file, passed: exists, exists, missingSymbols: [] });
}

let benchmark;
try {
  benchmark = JSON.parse(await readFile(path.join(root, "evidence/p26/benchmark-report.json"), "utf8"));
} catch {
  benchmark = null;
}
const benchmarkPassed =
  benchmark?.passed === true &&
  benchmark?.localOnly === true &&
  benchmark?.telemetryUploaded === false &&
  benchmark?.hardware?.id === "apple-m4-16gb" &&
  benchmark?.hardware?.cpuModel === "Apple M4" &&
  benchmark?.hardware?.memoryGiB === 16 &&
  Array.isArray(benchmark?.samples) &&
  benchmark.samples.length === 224 &&
  Array.isArray(benchmark?.budgetResults) &&
  benchmark.budgetResults.length === 8 &&
  benchmark.budgetResults.every((result) => result.passed === true);
results.push({
  task: "P26.01-P26.03,P26.11",
  file: "evidence/p26/benchmark-report.json",
  passed: benchmarkPassed,
  exists: benchmark !== null,
  missingSymbols: benchmarkPassed
    ? []
    : ["valid local M4/16 GB report with 224 samples and 8 passing budgets"],
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P26", taskRange: "P26.01-P26.11", passed, results }, null, 2));
if (!passed) process.exitCode = 1;
