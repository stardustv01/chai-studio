import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { evaluatePerformanceBudget, LocalPerformanceLedger } from "../packages/diagnostics/dist/index.js";
import {
  assertValidTimelineCore,
  buildTimelineDerivedIndexes,
  createEmptyTimelineSnapshot,
  createFrameRange,
  diffTimelineSnapshots,
  masterFrame,
  searchTimelineIndex,
  stableEntityId,
  TimelineDerivedIndexCache,
} from "../packages/timeline/dist/index.js";
import { normalizeRational } from "../packages/schema/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureManifest = JSON.parse(
  await readFile(path.join(root, "fixtures/performance/project-classes.json"), "utf8"),
);
const budgetManifest = JSON.parse(
  await readFile(path.join(root, "fixtures/performance/budgets.json"), "utf8"),
);
const hardware = detectHardware();
if (hardware.cpuModel !== "Apple M4" || hardware.memoryGiB !== 16 || hardware.architecture !== "arm64") {
  throw new Error(
    `P26 benchmark support claim is frozen to Apple M4/16 GB arm64; observed ${hardware.cpuModel}/${String(hardware.memoryGiB)} GB/${hardware.architecture}.`,
  );
}

const ledger = new LocalPerformanceLedger(10_000);
const cacheResults = [];
for (const fixture of fixtureManifest.fixtures) {
  const timeline = buildFixture(fixture);
  for (let run = 0; run < 7; run += 1) {
    measure(ledger, "schema-validation", fixture, run === 0, () => assertValidTimelineCore(timeline));
    let indexes;
    measure(ledger, "derived-index-rebuild", fixture, run === 0, () => {
      indexes = buildTimelineDerivedIndexes(timeline);
    });
    measure(ledger, "timeline-search", fixture, run === 0, () => {
      searchTimelineIndex(indexes, "clip mixed", 100);
    });
    measure(ledger, "revision-diff", fixture, run === 0, () => {
      diffTimelineSnapshots(timeline, timeline);
    });
  }
  const cache = new TimelineDerivedIndexCache();
  cache.get(timeline);
  cache.get(timeline);
  cacheResults.push({ fixtureId: fixture.id, ...cache.snapshot() });
}

const samples = ledger.snapshot();
const budgetResults = budgetManifest.budgets.map((budget) => {
  const fixture = fixtureManifest.fixtures.find((item) => item.projectClass === budget.projectClass);
  if (fixture === undefined) throw new Error(`Missing fixture for ${budget.projectClass}.`);
  return evaluatePerformanceBudget(budget, fixture, samples);
});
const passed = budgetResults.every((result) => result.passed);
const report = {
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  passed,
  localOnly: true,
  telemetryUploaded: false,
  hardware,
  fixtureManifestSha256: sha256(await readFile(path.join(root, "fixtures/performance/project-classes.json"))),
  budgetManifestSha256: sha256(await readFile(path.join(root, "fixtures/performance/budgets.json"))),
  samples,
  cacheResults,
  budgetResults,
};
await mkdir(path.join(root, "evidence/p26"), { recursive: true });
await writeFile(
  path.join(root, "evidence/p26/benchmark-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    { passed, sampleCount: samples.length, budgetCount: budgetResults.length, hardware },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;

function measure(ledger, metric, fixture, cold, operation) {
  const started = performance.now();
  operation();
  ledger.record({
    schemaVersion: "1.0.0",
    metric,
    unit: "milliseconds",
    value: performance.now() - started,
    hardwareClassId: "apple-m4-16gb",
    fixtureId: fixture.id,
    cold,
    observedAt: new Date().toISOString(),
    localOnly: true,
    detail: { projectClass: fixture.projectClass, clipCount: fixture.clipCount },
  });
}

function buildFixture(fixture) {
  const timelineId = stableEntityId(`timeline-${fixture.id}`);
  const audioBusId = stableEntityId(`bus-${fixture.id}-master`);
  const base = createEmptyTimelineSnapshot({
    id: timelineId,
    projectId: stableEntityId(`project-${fixture.id}`),
    revisionId: stableEntityId(`revision-${fixture.id}`),
    name: fixture.id,
    fps: normalizeRational(30n, 1n),
  });
  const tracks = {};
  const clips = {};
  const clipIdsByTrack = Array.from({ length: fixture.trackCount }, () => []);
  for (let index = 0; index < fixture.clipCount; index += 1) {
    const trackIndex = index % fixture.trackCount;
    const trackId = stableEntityId(`track-${fixture.id}-${String(trackIndex).padStart(3, "0")}`);
    const clipId = stableEntityId(`clip-${fixture.id}-${String(index).padStart(5, "0")}`);
    const start = BigInt(Math.floor((index * fixture.durationFrames) / fixture.clipCount));
    const duration = BigInt(Math.max(1, Math.floor(fixture.durationFrames / fixture.clipCount)));
    clips[clipId] = {
      id: clipId,
      trackId,
      assetId: stableEntityId(`asset-${fixture.id}-${String(index).padStart(5, "0")}`),
      nestedSequenceId: null,
      engine: index % 3 === 0 ? "hyperframes" : index % 3 === 1 ? "remotion" : "shared",
      name: `Clip mixed ${String(index)}`,
      range: createFrameRange(masterFrame(start), masterFrame(start + duration)),
      sourceRange: createFrameRange(masterFrame(0n), masterFrame(duration)),
      sourceRate: normalizeRational(30n, 1n),
      speed: normalizeRational(1n, 1n),
      availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(duration + 600n)),
      linkGroupId: null,
      selectionGroupId: null,
      transitionInId: null,
      transitionOutId: null,
      keyframeIds: [],
      metadata: { capability: "unified", performanceFixture: fixture.projectClass },
    };
    clipIdsByTrack[trackIndex].push(clipId);
  }
  const trackIds = clipIdsByTrack.map((clipIds, index) => {
    const trackId = stableEntityId(`track-${fixture.id}-${String(index).padStart(3, "0")}`);
    const kind = index % 4 === 3 ? "audio" : "video";
    tracks[trackId] = {
      id: trackId,
      kind,
      name: `Track ${String(index + 1)}`,
      order: index,
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
      audioBusId: kind === "audio" ? audioBusId : null,
      clipIds,
    };
    return trackId;
  });
  return {
    ...base,
    duration: masterFrame(BigInt(fixture.durationFrames)),
    trackIds,
    tracks,
    audioBusIds: [audioBusId],
    audioBuses: {
      [audioBusId]: { id: audioBusId, name: "Master", order: 0, muted: false, solo: false, gain: 1 },
    },
    clips,
  };
}

function detectHardware() {
  return {
    id: "apple-m4-16gb",
    platform: os.platform(),
    architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    gpuClass: "Apple M4 integrated",
    osRelease: os.release(),
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
