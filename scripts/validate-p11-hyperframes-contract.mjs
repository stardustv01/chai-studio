import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "packages/engine-adapters/src/hyperframes/contracts.ts",
  "packages/engine-adapters/src/hyperframes/diagnostics.ts",
  "packages/engine-adapters/src/hyperframes/parser.ts",
  "packages/engine-adapters/src/hyperframes/process-runtime.ts",
  "packages/engine-adapters/src/hyperframes/discovery.ts",
  "packages/engine-adapters/src/hyperframes/validation.ts",
  "packages/engine-adapters/src/hyperframes/player-host.ts",
  "packages/engine-adapters/src/hyperframes/renderer.ts",
  "packages/engine-adapters/src/hyperframes/dependencies.ts",
  "packages/engine-adapters/src/hyperframes/inspector.ts",
  "packages/engine-adapters/src/hyperframes/trust-policy.ts",
  "packages/engine-adapters/src/hyperframes/worker-router.ts",
  "tests/unit/hyperframes-discovery-validation.test.ts",
  "tests/unit/hyperframes-player-host.test.ts",
  "tests/unit/hyperframes-render-dependencies.test.ts",
  "tests/unit/hyperframes-capability-upgrade.test.ts",
  "tests/integration/hyperframes-real-runtime.test.ts",
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

const checks = [
  includesEvery("P11.01 HTML composition discovery", "packages/engine-adapters/src/hyperframes/parser.ts", [
    "data-composition-id",
    "data-composition-variables",
    "data-track-index",
    "data-duration",
    "detectFrameAdapters",
  ]),
  includesEvery(
    "P11.02 check diagnostic integration",
    "packages/engine-adapters/src/hyperframes/validation.ts",
    [
      '"lint"',
      '"check"',
      "cliFindingToDiagnostic",
      "hyperframes.validation.nondeterministic-api",
      "hyperframes.validation.expensive-state",
      "hyperframes.network.unapproved",
    ],
  ),
  includesEvery(
    "P11.03 isolated Player lifecycle",
    "packages/engine-adapters/src/hyperframes/player-host.ts",
    [
      "nativeAudioSuppressed: true",
      "autoplay: false",
      "presentFrame(",
      "waitUntilReady",
      "suspend(",
      "dispose(",
    ],
  ),
  includesEvery("P11.04 synchronized playback", "packages/engine-adapters/src/hyperframes/player-host.ts", [
    "beginSynchronizedPlayback",
    "reportPlaybackState",
    "droppedFrames",
    "muted: true",
    "stale scheduler session",
  ]),
  includesEvery("P11.05 exact still and range", "packages/engine-adapters/src/hyperframes/renderer.ts", [
    '"png-sequence"',
    "normalizedPixelHash",
    "renderRange",
    "strictEnvironmentFingerprint",
    "dependencyGraphHash",
    "HyperframesRenderCancelledError",
    "await rm(request.outputPath, { force: true })",
  ]),
  includesEvery("P11.06 dependency collection", "packages/engine-adapters/src/hyperframes/dependencies.ts", [
    '"html"',
    '"css"',
    '"media"',
    '"font"',
    '"script"',
    '"adapter"',
    '"package"',
    '"shader"',
    '"data"',
    '"variables"',
    '"approved-network"',
  ]),
  includesEvery("P11.07 native inspector", "packages/engine-adapters/src/hyperframes/inspector.ts", [
    "createHyperframesInspectorDescriptor",
    "timingAttributeCount",
    "frameAdapters",
    "safeVariableIds",
    "capabilityClassifications",
  ]),
  includesEvery(
    "P11.08 policy violation reporting",
    "packages/engine-adapters/src/hyperframes/validation.ts",
    [
      "hyperframes.policy.popup",
      "hyperframes.policy.navigation",
      "hyperframes.policy.download",
      "hyperframes.policy.dynamic-code",
      "hyperframes.validation.independent-clock",
    ],
  ),
  includesEvery(
    "P11.09 trust worker and cache separation",
    "packages/engine-adapters/src/hyperframes/worker-router.ts",
    [
      "distinct runtime identities",
      "Imported HyperFrames execution is disabled",
      "sandbox-exec-network-denial",
      "separate-browser-profile",
      "wall-time-output-memory-caps",
      "adversarialEvidenceHash",
    ],
  ),
  includesEvery("P11.10 capability upgrade fixture", "tests/unit/hyperframes-capability-upgrade.test.ts", [
    '"gsap"',
    '"lottie"',
    '"three"',
    '"rive"',
    '"waapi"',
    '"d3"',
    '"pixijs"',
    '"shader"',
    '"custom"',
  ]),
  includesEvery("real boundary-frame fixture", "tests/integration/hyperframes-real-runtime.test.ts", [
    "HyperframesCliRuntime",
    'frame: "57"',
    "acceptedFrame57.normalizedPixelHash",
    "renderer.renderRange",
    'codec: "h264"',
  ]),
  includesEvery("P09 adapter conformance", "tests/unit/hyperframes-player-host.test.ts", [
    "runPreviewAdapterConformance",
    "result.passed",
    'result.adapterVersion).toBe("0.7.58")',
  ]),
  {
    name: "HyperFrames is exactly pinned",
    passed: adapterManifest.dependencies?.hyperframes === "0.7.58",
    actual: adapterManifest.dependencies?.hyperframes,
  },
  {
    name: "adapter does not leak ownership into project schema",
    passed: !Object.entries(contents)
      .filter(([relativePath]) => relativePath.startsWith("packages/engine-adapters/src/hyperframes/"))
      .some(([, content]) => content.includes("ChaiProjectDocument")),
  },
];

const report = {
  passed: checks.every((check) => check.passed),
  phase: "P11",
  taskRange: "P11.01-P11.10",
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
