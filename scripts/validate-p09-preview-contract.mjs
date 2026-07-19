import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "packages/preview/src/transport-machine.ts",
  "packages/preview/src/master-clock.ts",
  "packages/preview/src/scheduler.ts",
  "packages/preview/src/buffering.ts",
  "packages/preview/src/quality-policy.ts",
  "packages/preview/src/layer-compositor.ts",
  "packages/preview/src/layer-lifecycle.ts",
  "packages/preview/src/preview-contract.ts",
  "packages/preview/src/audio-policy.ts",
  "packages/preview/src/color-normalization.ts",
  "packages/preview/src/conformance.ts",
  "packages/preview/src/session-state.ts",
  "apps/studio-server/src/preview-service.ts",
  "apps/studio-web/src/use-studio-runtime.ts",
  "tests/fixtures/preview-fixtures.ts",
  "tests/unit/preview-transport-clock.test.ts",
  "tests/unit/preview-compositor-policy.test.ts",
  "tests/unit/preview-scheduler.test.ts",
  "tests/unit/web-preview-events.test.ts",
  "tests/integration/preview-mixed-engine.test.ts",
];

const contents = Object.fromEntries(
  await Promise.all(
    requiredFiles.map(async (relativePath) => [
      relativePath,
      await readFile(path.join(root, relativePath), "utf8"),
    ]),
  ),
);

const checks = [
  includesEvery("transport states", "packages/preview/src/transport-machine.ts", [
    '"stopped"',
    '"loading"',
    '"paused"',
    '"playing"',
    '"seeking"',
    '"buffering"',
    '"error"',
    '"disposed"',
    "InvalidPreviewTransportTransitionError",
  ]),
  includesEvery("rational clock", "packages/preview/src/master-clock.ts", [
    "masterFrame",
    "presentationTimestamp",
    "timelineFps",
    "playRate",
    "loopRange",
    "inOutRange",
    "stepSeconds",
  ]),
  includesEvery("seek and playback scheduler", "packages/preview/src/scheduler.ts", [
    "PreviewSeekBarrierResult",
    "nativeAudioSuppressed",
    "reportDrift",
    "hardResynchronizeIfRequired",
    "reportAudioSync",
    "requestFidelityFrame",
    "requestFidelityRange",
  ]),
  includesEvery("buffering and quality", "packages/preview/src/buffering.ts", [
    "back-pressure",
    "waitingFor",
    "staleAdapterIds",
    "intersectRanges",
  ]),
  includesEvery("integrity warnings", "packages/preview/src/quality-policy.ts", [
    "missing-asset",
    "missing-font",
    "stale-cache",
    "dropped-frames",
    "render-required-difference",
    "createPreviewIntegrityWarnings",
  ]),
  includesEvery("layer compositor", "packages/preview/src/layer-compositor.ts", [
    "zIndex",
    "sourceOrder",
    "blendMode",
    "letterbox",
    "pillarbox",
    "activePreviewLayers",
  ]),
  includesEvery("layer lifecycle", "packages/preview/src/layer-lifecycle.ts", [
    '"preloading"',
    '"presenting"',
    '"suspended"',
    '"error"',
    '"disposed"',
  ]),
  includesEvery("audio policy", "packages/preview/src/audio-policy.ts", [
    "silent-scrub",
    "nativeEngineAudioSuppressed",
    "deterministicStretch",
  ]),
  includesEvery("fidelity identity", "packages/preview/src/preview-contract.ts", [
    "strictEnvironmentFingerprint",
    "compositorId",
    "settingsHash",
    "dependencyGraphHash",
    "colorContractId",
    "alphaMode",
  ]),
  includesEvery("pixel normalization", "packages/preview/src/color-normalization.ts", [
    "premultiplied",
    "normalizePreviewPixelBuffer",
    "compareNormalizedPreviewPixels",
    "deterministicPreviewPixelHash",
  ]),
  includesEvery("adapter conformance", "packages/preview/src/conformance.ts", [
    "repeat-seek-determinism",
    "scheduler-owned-playback",
    "halt-and-suspend",
    "disposal",
  ]),
  includesEvery("serialized server preview", "apps/studio-server/src/preview-service.ts", [
    "#commandQueue",
    "#serialize",
    "timelineFps",
  ]),
  includesEvery("live warning UI", "apps/studio-web/src/use-studio-runtime.ts", [
    "previewTruthFromPayload",
    "parsePreviewWarnings",
    'action.event.type === "preview.state"',
  ]),
  includesEvery("mixed engine gate", "tests/integration/preview-mixed-engine.test.ts", [
    '"remotion"',
    '"hyperframes"',
    "hardResyncRequired",
    "requestFidelityFrame",
  ]),
  {
    name: "preview boundary does not import final render implementation",
    passed: !Object.entries(contents)
      .filter(([relativePath]) => relativePath.startsWith("packages/preview/src/"))
      .some(([, content]) => content.includes('from "@chai-studio/render"')),
  },
];

const report = {
  passed: checks.every((check) => check.passed),
  phase: "P09",
  taskRange: "P09.01-P09.14",
  checkedFiles: requiredFiles,
  checks,
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

function includesEvery(name, relativePath, markers) {
  const content = contents[relativePath] ?? "";
  const missing = markers.filter((marker) => !content.includes(marker));
  return { name, passed: missing.length === 0, missing };
}
