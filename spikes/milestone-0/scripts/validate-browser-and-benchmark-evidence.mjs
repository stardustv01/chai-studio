import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const evidence = path.join(root, "evidence");
const readJson = async (name) => JSON.parse(await readFile(path.join(evidence, name), "utf8"));
const preview = await readJson("interactive-preview-result.json");
const audio = await readJson("web-audio-result.json");
const stills = await readJson("native-still-benchmark.json");
const resources = await readJson("resource-benchmark.json");
const proxyManifest = JSON.parse(await readFile(path.join(root, "fixtures", "preview", "proxy-manifest.json"), "utf8"));
const ageMs = (timestamp) => Date.now() - Date.parse(timestamp);
const assertions = {
  previewPassed: preview.passed === true,
  nativeProxyCoverage: preview.observations.proxyManifest.totalFrames === 120,
  nativeProxyIdentity: proxyManifest.identity === preview.observations.proxyManifest.identity,
  nativeProxySeekBudget: preview.observations.warmSeek.sampleCount === 100 && preview.observations.warmSeek.p95Ms <= preview.observations.warmSeek.budgetMs,
  hardResyncParity: preview.observations.driftProbe.before.deltaFrames === 1 && preview.observations.driftProbe.afterHardResync.deltaFrames === 0,
  approximationTruthful: preview.assertions.interactiveApproximationWarningVisible && preview.assertions.fidelityModeHidesApproximationWarning,
  webAudioPassed: audio.passed === true && audio.offlineGraph.endpointSampleExact === true && audio.offlineGraph.renderedSamples === 480480,
  noBrowserConsoleErrors: audio.consoleErrors.length === 0,
  browserEvidenceTimestampValid: Number.isFinite(ageMs(audio.generatedAt)) && ageMs(audio.generatedAt) >= 0,
  nativeStillBudget: stills.passed === true && stills.hyperframes.p95Ms <= 5000 && stills.remotion.p95Ms <= 5000,
  nativeStillsDeterministic: stills.hyperframes.deterministic && stills.remotion.deterministic,
  resourcePlatform: resources.platform === `${process.platform}-${process.arch}`,
  resourceBudget: resources.mixedFinish.maximumResidentSetBytes < 1024 ** 3 && resources.hyperframes.maximumResidentSetBytes < 1024 ** 3,
  zeroSwaps: resources.mixedFinish.swaps === 0 && resources.hyperframes.swaps === 0,
};
const report = {passed: Object.values(assertions).every(Boolean), assertions};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
