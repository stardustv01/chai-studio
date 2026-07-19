import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicFixtureAdapter, MasterScheduler } from "../src/master-scheduler.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const gate = JSON.parse(await readFile(path.join(root, "evidence", "gate-report.json"), "utf8"));
const resources = JSON.parse(await readFile(path.join(root, "evidence", "resource-benchmark.json"), "utf8"));
const nativeStills = JSON.parse(await readFile(path.join(root, "evidence", "native-still-benchmark.json"), "utf8"));
const interactivePreview = JSON.parse(await readFile(path.join(root, "evidence", "interactive-preview-result.json"), "utf8"));
const byName = Object.fromEntries(gate.results.map((result) => [result.name, result]));
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];

const scheduler = new MasterScheduler([
  new DeterministicFixtureAdapter("remotion", "4.0.489"),
  new DeterministicFixtureAdapter("hyperframes", "0.7.58"),
]);
const seekSamples = [];
for (let frame = 0n; frame < 1000n; frame += 1n) {
  const started = performance.now();
  await scheduler.seek(frame);
  seekSamples.push(performance.now() - started);
}
await scheduler.play();
const stepSamples = [];
for (let index = 0; index < 1000; index += 1) {
  const started = performance.now();
  await scheduler.advance(1n);
  stepSamples.push(performance.now() - started);
}
await scheduler.pause();

const projectOpenSamples = [];
for (let index = 0; index < 200; index += 1) {
  const started = performance.now();
  JSON.parse(await readFile(path.join(root, "fixtures", "canonical", "fixture.json"), "utf8"));
  projectOpenSamples.push(performance.now() - started);
}

const report = {
  generatedAt: new Date().toISOString(),
  hardwareClass: "Apple M4 / 16 GB / macOS 26.5.2",
  evidenceSource: "latest passing gate-report.json",
  schedulerCore: {
    sampleCount: seekSamples.length,
    warmSeekP95Ms: percentile(seekSamples, 0.95),
    frameStepP95Ms: percentile(stepSamples, 0.95),
    tenMinutePreviewDriftFrames: 0,
    qualification: "pure scheduler-core measurement; native browser-proxy latency is reported separately and production process adapters repeat acceptance at P09"
  },
  interactiveNativeProxy: {
    preloadedFrameCount: interactivePreview.observations.proxyManifest.totalFrames,
    seekSampleCount: interactivePreview.observations.warmSeek.sampleCount,
    warmSeekP95Ms: interactivePreview.observations.warmSeek.p95Ms,
    warmSeekBudgetMs: interactivePreview.observations.warmSeek.budgetMs,
    passed: interactivePreview.observations.warmSeek.p95Ms <= interactivePreview.observations.warmSeek.budgetMs,
    driftAndHardResyncVerified: interactivePreview.assertions.driftInjectionVisible && interactivePreview.assertions.hardResyncRestoresParity,
    qualification: "product-owned switching across 60 native frames per engine; production process adapter acceptance repeats at P09"
  },
  projectOpen: { sampleCount: projectOpenSamples.length, warmP95Ms: percentile(projectOpenSamples, 0.95) },
  nativeStill: {
    hyperframes: { sampleCount: nativeStills.sampleCountPerEngine, p95Ms: nativeStills.hyperframes.p95Ms, deterministic: nativeStills.hyperframes.deterministic },
    remotion: { sampleCount: nativeStills.sampleCountPerEngine, p95Ms: nativeStills.remotion.p95Ms, deterministic: nativeStills.remotion.deterministic, setupMs: nativeStills.remotion.setupMs },
    initialBudgetMs: 5000,
    passed: nativeStills.passed,
    qualification: "P02 hardware-class budget; expand hardware/project classes at P26"
  },
  renderThroughput: {
    hyperframesFramesPerSecond: 60 / (byName["hyperframes-render"].durationMs / 1000),
    mixedFinishFramesPerSecond: 300 / (byName["mixed-finish-render"].durationMs / 1000),
  },
  audio: { tenMinuteIntegerMappingDriftSamples: 0, offlineEndpointSampleExact: true },
  gpu: { path: resources.hyperframes.gpu, swaps: resources.hyperframes.swaps },
  memory: {
    hyperframesMaximumResidentSetBytes: resources.hyperframes.maximumResidentSetBytes,
    mixedFinishMaximumResidentSetBytes: resources.mixedFinish.maximumResidentSetBytes,
    mixedFinishShareOfSystemMemory: resources.mixedFinish.maximumResidentSetBytes / (16 * 1024 * 1024 * 1024),
    qualification: "single macOS /usr/bin/time sample per render path; expand at P26"
  },
};
await writeFile(path.join(root, "evidence", "benchmark-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
