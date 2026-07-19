import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P16.01",
    "packages/schema/src/project-documents.ts",
    [
      "AudioGraphDocument",
      "AudioGraphSource",
      "AudioGraphClip",
      "AudioGraphBus",
      "AudioAutomationLane",
      "AudioDuckingRule",
      "AudioChannelMap",
      "AudioSyncAnchor",
      "AudioProcessingReference",
    ],
  ],
  [
    "P16.02",
    "packages/audio/src/sample-mapping.ts",
    ["sampleRangeForFrames", "sampleBoundaryForFrame", "floorDivide", "ceilDivide"],
  ],
  [
    "P16.03",
    "packages/audio/src/decode-cache.ts",
    [
      "AudioDecodeCache",
      "selectAudioDecodeInputPath",
      "normalizeDecodedAudioBlock",
      "previewPolicy",
      "targetSampleRate",
      "targetChannels",
      "gaps",
    ],
  ],
  [
    "P16.04",
    "packages/audio/src/web-audio.ts",
    [
      "WebAudioGraphBackend",
      "AudioContext",
      "schedulerSessionId",
      "nativeEngineAudioSuppressed",
      "droppedBufferCount",
      "connectExplicitChannelMap",
      "scheduleAutomationLane",
    ],
  ],
  [
    "P16.04",
    "packages/audio/src/preview-follower.ts",
    [
      "AuthoritativeAudioPreviewFollower",
      "sampleBoundaryForFrame",
      "playRate",
      "stale scheduler session",
      "reportBufferHealth",
    ],
  ],
  [
    "P16.04",
    "packages/preview/src/audio-policy.ts",
    ["bounded-grain", "frame-step", "nativeEngineAudioSuppressed"],
  ],
  ["P16.04", "packages/preview/src/scheduler.ts", ["PreviewScrubResult", "auditionScrub", "audioAuditioned"]],
  [
    "P16.05",
    "packages/audio/src/evaluation.ts",
    ["gainDb", "muted", "solo", "equalPowerPan", "clipFadeGain", "crossfadeGainAtFrame"],
  ],
  [
    "P16.06",
    "packages/audio/src/graph.ts",
    ["voiceover", "music", "sfx", "ambience", "master", "parentBusId"],
  ],
  [
    "P16.07",
    "packages/audio/src/ducking.ts",
    ["generateDuckingAutomation", "thresholdDb", "reductionDb", "attackFrames", "releaseFrames"],
  ],
  [
    "P16.08",
    "packages/audio/src/preprocessing.ts",
    ["preservesOriginal", "attributable", "generatedAssetId", "inputContentHash", "outputContentHash"],
  ],
  [
    "P16.09",
    "packages/audio/src/offline.ts",
    [
      "renderOfflineAudioMix",
      "buildFfmpegAudioGraph",
      "normalizeOfflineDecodedBlock",
      "pcm-f32le",
      "AbortError",
      "artifactHash",
    ],
  ],
  [
    "P16.10",
    "packages/audio/src/measurements.ts",
    [
      "integratedLufs",
      "truePeakDbtp",
      "clippedSampleCount",
      "silentSampleCount",
      "channelPeaksDbfs",
      "durationSamples",
    ],
  ],
  [
    "P16.10",
    "apps/studio-server/src/render-service.ts",
    [
      "RenderAudioEvidence",
      "renderAudioEvidenceFromMixArtifact",
      "chai-audio-measurements-v1",
      "validateAudioEvidence",
      "measurements: receipt.audio",
      "qaReport",
    ],
  ],
  [
    "P16.11",
    "apps/studio-web/src/audio-mixer-panel.tsx",
    [
      "audio-waveform",
      "stereo-meter",
      "automation-line",
      "fade-handle",
      "sync-anchor",
      "createAudioInspectorDescriptor",
      "audio.edit",
    ],
  ],
  [
    "P16.12",
    "tests/unit/audio-core.test.ts",
    ["24-hour", "equal-power", "ducking", "clipping", "scheduler sessions"],
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
  "tests/unit/audio-core.test.ts",
  "tests/unit/audio-web-audio.test.ts",
  "tests/property/audio-sample-mapping.property.test.ts",
  "tests/integration/audio-document-command.test.ts",
  "tests/integration/audio-preview-scheduler.test.ts",
  "tests/integration/audio-offline-mix.test.ts",
  "tests/integration/server-render-api.test.ts",
  "tests/e2e/audio-mixer.spec.ts",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "test-evidence", file, passed: exists, exists, missingSymbols: [] });
}

const visualDirectory = path.join(root, "tests/e2e/studio-visual.spec.ts-snapshots");
let visualFiles;
try {
  visualFiles = (await readdir(visualDirectory)).filter((file) => file.endsWith("-darwin.png")).sort();
} catch {
  visualFiles = [];
}
const requiredVisual = "p16-authoritative-audio-mixer-darwin.png";
results.push({
  task: "P16.11",
  file: path.relative(root, visualDirectory),
  passed: visualFiles.includes(requiredVisual),
  exists: visualFiles.length > 0,
  missingSymbols: visualFiles.includes(requiredVisual) ? [] : [requiredVisual],
  p16VisualCount: visualFiles.includes(requiredVisual) ? 1 : 0,
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ passed, taskCount: 12, checks: results }, null, 2));
if (!passed) process.exitCode = 1;
