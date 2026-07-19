import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "packages/engine-adapters/src/remotion/contracts.ts",
  "packages/engine-adapters/src/remotion/runtime-contract.ts",
  "packages/engine-adapters/src/remotion/diagnostics.ts",
  "packages/engine-adapters/src/remotion/validation.ts",
  "packages/engine-adapters/src/remotion/discovery.ts",
  "packages/engine-adapters/src/remotion/player-host.ts",
  "packages/engine-adapters/src/remotion/node-runtime.ts",
  "packages/engine-adapters/src/remotion/png-normalization.ts",
  "packages/engine-adapters/src/remotion/renderer.ts",
  "packages/engine-adapters/src/remotion/dependencies.ts",
  "packages/engine-adapters/src/remotion/inspector.ts",
  "packages/engine-adapters/src/remotion/finishing.ts",
  "tests/unit/remotion-discovery-validation.test.ts",
  "tests/unit/remotion-player-host.test.ts",
  "tests/unit/remotion-render-dependencies.test.ts",
  "tests/integration/remotion-real-runtime.test.ts",
];

const contents = Object.fromEntries(
  await Promise.all(
    requiredFiles.map(async (relativePath) => [
      relativePath,
      await readFile(path.join(root, relativePath), "utf8"),
    ]),
  ),
);
const adapterManifest = JSON.parse(
  await readFile(path.join(root, "packages/engine-adapters/package.json"), "utf8"),
);
const pinnedPackages = ["@remotion/bundler", "@remotion/player", "@remotion/renderer", "remotion"];

const checks = [
  includesEvery("P10.01 composition discovery", "packages/engine-adapters/src/remotion/discovery.ts", [
    "discoverRemotionCompositions",
    "remotion.composition.duplicate-id",
    "remotion.composition.selection-ambiguous",
    "remotion.composition.fps-invalid",
    "durationFrames",
  ]),
  includesEvery("P10.02 source validation", "packages/engine-adapters/src/remotion/validation.ts", [
    "validateRemotionSource",
    "remotion.delay.not-approved",
    "remotion.asset.missing",
    "remotion.network.unapproved",
    "remotion.version.unpinned",
    "remotion.props.not-json-safe",
  ]),
  includesEvery("P10.03 Player host lifecycle", "packages/engine-adapters/src/remotion/player-host.ts", [
    "preload(",
    "presentFrame(",
    "waitUntilReady",
    "currentFrame",
    "suspend(",
    "dispose(",
  ]),
  includesEvery("P10.04 synchronized playback", "packages/engine-adapters/src/remotion/player-host.ts", [
    "beginSynchronizedPlayback",
    "reportPlaybackState",
    "nativeAudioSuppressed: true",
    "muted: true",
    "droppedFrames",
  ]),
  includesEvery("P10.05 exact still identity", "packages/engine-adapters/src/remotion/renderer.ts", [
    "renderStill",
    "normalizedPixelHash",
    "strictEnvironmentFingerprint",
    "dependencyGraphHash",
    "colorContractId",
    "browserIdentity",
  ]),
  includesEvery("P10.06 range rendering", "packages/engine-adapters/src/remotion/renderer.ts", [
    "renderRange",
    "endFrameExclusive",
    "RemotionRenderCancelledError",
    "onProgress",
    "await rm(request.outputPath, { force: true })",
  ]),
  includesEvery("P10.07 dependency collection", "packages/engine-adapters/src/remotion/dependencies.ts", [
    '"source-module"',
    '"input-props"',
    '"media"',
    '"font"',
    '"runtime-package"',
    '"approved-network"',
    '"generated-code"',
    "dependencyGraphHash",
  ]),
  includesEvery("P10.08 mapped diagnostics", "packages/engine-adapters/src/remotion/diagnostics.ts", [
    "parseRemotionSourceStack",
    "browserLogToDiagnostic",
    "repairHint",
    "compositionId",
    "frame",
  ]),
  includesEvery("P10.09 safe inspector", "packages/engine-adapters/src/remotion/inspector.ts", [
    "createRemotionInspectorDescriptor",
    "safeInputPropNames",
    "sourcePath",
    "capabilityClassifications",
    '"bake_required"',
  ]),
  includesEvery("P10.10 replaceable finishing", "packages/engine-adapters/src/remotion/finishing.ts", [
    "generateRemotionFinishingComposition",
    'interfaceVersion: "chai-finishing-compositor.v1"',
    "OffthreadVideo",
    "sourceHash",
    "dependencies",
  ]),
  includesEvery("real runtime fixture", "tests/integration/remotion-real-runtime.test.ts", [
    "NodeRemotionRuntime",
    "ChaiMilestone0",
    "normalizedPixelHash",
    "renderer.renderRange",
    'codec: "h264"',
  ]),
  includesEvery("upgrade compatibility fixture", "tests/unit/remotion-discovery-validation.test.ts", [
    'renderer: "4.0.490"',
    "remotion.runtime.version-mismatch",
    "expect(runtime.calls).toEqual([])",
  ]),
  {
    name: "Remotion family is exactly pinned",
    passed: pinnedPackages.every((packageName) => adapterManifest.dependencies?.[packageName] === "4.0.489"),
    actual: Object.fromEntries(
      pinnedPackages.map((packageName) => [packageName, adapterManifest.dependencies?.[packageName]]),
    ),
  },
  {
    name: "adapter does not leak ownership into project schema",
    passed: !Object.entries(contents)
      .filter(([relativePath]) => relativePath.startsWith("packages/engine-adapters/src/remotion/"))
      .some(([, content]) => content.includes("ChaiProjectDocument")),
  },
];

const report = {
  passed: checks.every((check) => check.passed),
  phase: "P10",
  taskRange: "P10.01-P10.10",
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
