import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "packages/engine-adapters/src/capabilities/contracts.ts",
  "packages/engine-adapters/src/capabilities/registry.ts",
  "packages/engine-adapters/src/capabilities/consumers.ts",
  "packages/engine-adapters/src/capabilities/initial-registry.ts",
  "packages/preview/src/shared/contracts.ts",
  "packages/preview/src/shared/sampling.ts",
  "packages/preview/src/shared/captions.ts",
  "packages/preview/src/shared/effects.ts",
  "packages/preview/src/shared/transitions.ts",
  "packages/preview/src/shared/fallback.ts",
  "packages/preview/src/shared/audio.ts",
  "packages/preview/src/shared/adapter.ts",
  "tests/unit/capability-registry.test.ts",
  "tests/unit/shared-preview-adapter.test.ts",
  "tests/property/shared-transitions.property.test.ts",
  "tests/integration/shared-preview-mixed-engine.test.ts",
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
  includesEvery(
    "P12.01 registry schema and statuses",
    "packages/engine-adapters/src/capabilities/contracts.ts",
    [
      '"native"',
      '"unified"',
      '"bake_required"',
      '"fallback_available"',
      '"unsupported"',
      '"experimental"',
      "owner",
      "previewBehavior",
      "renderBehavior",
      "fallback",
      "fixture",
      "evidence",
    ],
  ),
  includesEvery(
    "P12.02 evidence-backed capability families",
    "packages/engine-adapters/src/capabilities/contracts.ts",
    [
      '"typography"',
      '"media"',
      '"captions"',
      '"audio"',
      '"react"',
      '"html-css"',
      '"svg"',
      '"canvas"',
      '"lottie"',
      '"rive"',
      '"gsap"',
      '"waapi"',
      '"three-webgl"',
      '"shaders"',
      '"particles"',
      '"transitions"',
      '"alpha"',
      '"hdr-color-depth"',
      '"distributed-rendering"',
    ],
  ),
  includesEvery("P12.03 rational shared media sampling", "packages/preview/src/shared/sampling.ts", [
    "exactSourceFrame",
    "sourceToProxyScale",
    "sourceToProxyOffset",
    "floorDivide",
    "usedProxy",
  ]),
  includesEvery("P12.04 deterministic captions", "packages/preview/src/shared/captions.ts", [
    "endFrameExclusive",
    "cueId.localeCompare",
    "fontFileHash",
    "glyphHash",
    "activeSharedCaptionWords",
  ]),
  includesEvery("P12.05 common effects and warnings", "packages/preview/src/shared/effects.ts", [
    "transform",
    "opacity",
    "crop",
    "blendMode",
    "adjustmentRefs",
    "capabilityPreviewWarnings",
    "unsupported-effect",
  ]),
  includesEvery("P12.06 deterministic transition primitives", "packages/preview/src/shared/transitions.ts", [
    '"hard-cut"',
    '"dissolve"',
    '"dip"',
    '"wipe"',
    '"push"',
    '"slide"',
    '"zoom"',
    '"blur"',
    "endFrameExclusive",
    "sharedTransitionBoundaryOwner",
  ]),
  includesEvery("P12.07 fallback provenance", "packages/preview/src/shared/fallback.ts", [
    "sourceIdentity",
    "sourceContentHash",
    "cacheKey",
    "environmentClass",
    "producerVersion",
    "approximationLimits",
    "provenanceId",
  ]),
  includesEvery("P12.08 source audio isolation", "packages/preview/src/shared/audio.ts", [
    '"suppressed"',
    '"isolated-audition"',
    "nativeEngineAudioSuppressed: true",
    "connectedToMasterProgramGraph: false",
    "requiresExplicitAudition",
  ]),
  includesEvery(
    "P12.09 registry-driven consumers",
    "packages/engine-adapters/src/capabilities/consumers.ts",
    [
      "buildCapabilityInspectorDescriptors",
      "capabilityPreviewWarnings",
      "planCapabilityRender",
      "selectCapabilityFallback",
      "selectCapabilityUpgradeFixtures",
      "resolveCapability",
    ],
  ),
  includesEvery("P12.10 shared conformance and mixed fixture", "tests/unit/shared-preview-adapter.test.ts", [
    "runPreviewAdapterConformance",
    "result.passed",
    "sampleSharedVideoSource",
    "activeSharedCaptionCues",
    "usedBakedFallback",
  ]),
  includesEvery(
    "transition boundary property evidence",
    "tests/property/shared-transitions.property.test.ts",
    ["fast-check", "sharedTransitionBoundaryOwner", "blank included frame", "progress"],
  ),
  includesEvery(
    "real shared mixed-engine scheduling",
    "tests/integration/shared-preview-mixed-engine.test.ts",
    ["SharedPreviewAdapter", "PreviewScheduler", '"remotion"', '"hyperframes"', "new Set(identities)"],
  ),
  await fixturesExist(),
  {
    name: "shared preview adapter never imports project document ownership",
    passed: !Object.entries(contents)
      .filter(([relativePath]) => relativePath.startsWith("packages/preview/src/shared/"))
      .some(([, content]) => content.includes("ChaiProjectDocument")),
  },
];

const report = {
  passed: checks.every((check) => check.passed),
  phase: "P12",
  taskRange: "P12.01-P12.10",
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

async function fixturesExist() {
  const initialRegistry = contents["packages/engine-adapters/src/capabilities/initial-registry.ts"] ?? "";
  const paths = [
    "tests/unit/shared-preview-adapter.test.ts",
    "tests/property/shared-transitions.property.test.ts",
    "tests/unit/capability-registry.test.ts",
    "tests/integration/remotion-real-runtime.test.ts",
    "tests/integration/hyperframes-real-runtime.test.ts",
    "tests/unit/hyperframes-capability-upgrade.test.ts",
  ];
  const missing = [];
  for (const relativePath of paths) {
    try {
      await access(path.join(root, relativePath));
      if (!initialRegistry.includes(relativePath)) missing.push(`${relativePath} is not registry referenced`);
    } catch {
      missing.push(`${relativePath} is absent`);
    }
  }
  return { name: "all registry fixture paths exist", passed: missing.length === 0, missing };
}
