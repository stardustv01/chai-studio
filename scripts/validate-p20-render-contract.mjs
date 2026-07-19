import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P20.01",
    "packages/render/src/contracts.ts",
    ["RenderDagNode", "RenderNodeKind", "RenderPlan", "RenderArtifactMetadata"],
  ],
  ["P20.01", "packages/render/src/dag.ts", ["validateRenderDag", "contains a cycle", "unreachable nodes"]],
  [
    "P20.02-P20.04",
    "packages/render/src/identity.ts",
    [
      "mergeRenderDependencies",
      "buildRenderEnvironmentIdentity",
      "buildRenderCacheKey",
      "portable environment contract",
    ],
  ],
  [
    "P20.05",
    "packages/render/src/artifact-store.ts",
    [
      "ContentAddressedArtifactStore",
      "publish",
      "lookup",
      "content-corrupt",
      "quarantine",
      "cleanup",
      "last-use.json",
    ],
  ],
  [
    "P20.06",
    "packages/render/src/planning.ts",
    ["planCapabilityRequests", "createRenderPlan", "unsupported", "experimental", "blocking"],
  ],
  [
    "P20.07",
    "packages/render/src/nodes.ts",
    [
      "native-remotion",
      "native-hyperframes",
      "shared-media",
      "caption",
      "CachedArtifactNodeExecutor",
      "Validated cache hit",
    ],
  ],
  [
    "P20.08",
    "packages/render/src/bridge-scene.ts",
    [
      "BridgeSceneDocument",
      "audioEnvelope",
      "fallback",
      "preRollFrames",
      "postRollFrames",
      "exact declared duration",
    ],
  ],
  [
    "P20.09-P20.10",
    "packages/render/src/remotion-compositor.ts",
    ["RemotionMasterCompositor", "generateRemotionFinishingComposition", "implementationId"],
  ],
  [
    "P20.10-P20.15",
    "packages/render/src/execution.ts",
    ["assertVideoAudioAlignment", "createOutputCandidatePointer", "rendered_unchecked", "MasterCompositor"],
  ],
  [
    "P20.11-P20.12",
    "packages/render/src/encode.ts",
    ["runAtomicEncode", "partial", "transparent-overlay", "image-sequence", "audio-only"],
  ],
  [
    "P20.13",
    "packages/render/src/scheduler.ts",
    [
      "RenderDagScheduler",
      "RenderPauseController",
      "trustedConcurrency",
      "untrustedConcurrency",
      "gpuSlots",
      "resumeResults",
    ],
  ],
  [
    "P20.14",
    "packages/render/src/progress.ts",
    ["RenderProgressAggregator", "markArtifactsValidated", "estimateLabel", "0.999_999"],
  ],
  [
    "P20.15",
    "apps/studio-server/src/render-service.ts",
    [
      'receiptVersion: "1.0.0"',
      "plan: RenderPlan",
      "strictEnvironmentFingerprint",
      "dependencyManifest",
      "planIdentityHash",
      "rendered_unchecked",
    ],
  ],
  [
    "P20.16",
    "tests/property/render-cache-invalidation.property.test.ts",
    [
      "canonical object ordering",
      "meaningful source, environment, frame, quality, or seed change",
      "numRuns",
    ],
  ],
  [
    "P20.16",
    "tests/integration/render-dag-execution.test.ts",
    ["selectively invalidates one native branch", "Validated cache hit."],
  ],
  [
    "P20.01-P20.16",
    "tests/unit/render-dag-cache.test.ts",
    ["content-addressed cache", "quarantined", "capability registry"],
  ],
  [
    "P20.11-P20.12",
    "tests/unit/render-encode-compositor.test.ts",
    ["never exposes a failed partial", "replaceable interface"],
  ],
  [
    "P20.13-P20.14",
    "tests/unit/render-scheduler-progress.test.ts",
    ["propagates cancellation", "never reports complete before validation"],
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

for (const file of ["packages/render/package.json", "packages/render/tsconfig.json"]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P20.01-P20.16", file, passed: exists, exists, missingSymbols: [] });
}

const server = await readFile(path.join(root, "apps/studio-server/src/render-service.ts"), "utf8");
results.push({
  task: "P20.15",
  file: "apps/studio-server/src/render-service.ts",
  passed: !server.includes("placeholder-pending-p20") && !server.includes("1.0.0-placeholder"),
  exists: true,
  missingSymbols: server.includes("placeholder-pending-p20") ? ["remove P20 placeholder"] : [],
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P20", taskRange: "P20.01-P20.16", passed, results }, null, 2));
if (!passed) process.exitCode = 1;
