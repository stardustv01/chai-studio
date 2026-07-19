import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P15.01",
    "apps/studio-web/src/inspector-contract.ts",
    [
      "resolveInspectorContext",
      '"none"',
      '"clip"',
      '"clips"',
      '"track"',
      '"asset"',
      '"marker"',
      '"keyframe"',
      '"transition"',
      '"bridge"',
      '"caption"',
      '"render-output"',
    ],
  ],
  [
    "P15.02",
    "packages/timeline/src/fixture.ts",
    [
      "transform.position",
      "transform.scale",
      "transform.rotation",
      "transform.anchor",
      "transform.opacity",
      "transform.crop",
      "composite.blendMode",
      "time.speed",
      "audio.volume",
      "audio.fadeIn",
      "audio.fadeOut",
    ],
  ],
  [
    "P15.03",
    "apps/studio-web/src/inspector-panel.tsx",
    [
      "parseInspectorDraft",
      "inspector-scrubber",
      "Reset to default",
      'event.key === "Enter"',
      'event.key === "Escape"',
    ],
  ],
  [
    "P15.04",
    "packages/engine-adapters/src/remotion/inspector.ts",
    ["createRemotionInspectorDescriptor", "remotionInspectorPropertyStates", "native.remotion"],
  ],
  [
    "P15.04",
    "apps/studio-web/src/inspector-panel.tsx",
    ["Remotion composition", "calculatedMetadata", "Validate source", "Proxy bake unavailable"],
  ],
  [
    "P15.05",
    "packages/engine-adapters/src/hyperframes/inspector.ts",
    ["createHyperframesInspectorDescriptor", "hyperframesInspectorPropertyStates", "native.hyperframes"],
  ],
  [
    "P15.06",
    "apps/studio-web/src/inspector-contract.ts",
    ["safeToEdit", 'ownership === "shared"', "mixed", "propertyValuesEqual"],
  ],
  [
    "P15.06",
    "packages/timeline/src/commands.ts",
    ["clips.properties.update", "applyUpdateClipProperties", "atomic"],
  ],
  [
    "P15.07",
    "apps/studio-web/src/inspector-panel.tsx",
    ["capability", "bake_required", "unsupported", "Validate source", "Proxy bake unavailable"],
  ],
  [
    "P15.08",
    "apps/studio-web/src/keyframe-editor.tsx",
    [
      "keyframe.add",
      "keyframes.remove",
      "keyframes.add",
      "keyframes.update",
      "Copy",
      "Paste",
      "Align values",
      "Distribute time",
      "Retime 90%",
    ],
  ],
  [
    "P15.09",
    "packages/timeline/src/curves.ts",
    ["linear", "hold", "ease-in-out", "cubicBezierYForX", "speed", "32"],
  ],
  [
    "P15.10",
    "apps/studio-web/src/inspector-panel.tsx",
    ["Native animation owns this property", "Convert to shared"],
  ],
  [
    "P15.10",
    "packages/timeline/src/commands.ts",
    ["clips.properties.convert-to-shared", "supportsSharedConversion", "nativeAnimation"],
  ],
  [
    "P15.11",
    "apps/studio-web/src/inspector-contract.ts",
    ["inspectorImpact", "dependencySummary", "cacheSummary", "affectedRange"],
  ],
  [
    "P15.12",
    "packages/timeline/src/document-adapter.ts",
    ["properties", "keyframes", "automation", "keyframes.update"],
  ],
  [
    "P15.12",
    "tests/e2e/contextual-inspector.spec.ts",
    ["explicit native-animation conversion", "multi-selection", "curve editor"],
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
  "tests/unit/inspector-contract.test.ts",
  "tests/unit/timeline-inspector-properties.test.ts",
  "tests/unit/timeline-document-adapter.test.ts",
  "tests/e2e/contextual-inspector.spec.ts",
  "tests/e2e/studio-visual.spec.ts",
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
let visualFiles = [];
try {
  visualFiles = (await readdir(visualDirectory)).filter((file) => file.endsWith("-darwin.png")).sort();
} catch {
  visualFiles = [];
}
const requiredVisuals = [
  "p15-contextual-inspector-darwin.png",
  "p15-native-inspector-impact-darwin.png",
  "p15-keyframe-curve-editor-darwin.png",
];
const missingVisuals = requiredVisuals.filter((file) => !visualFiles.includes(file));
results.push({
  task: "P15.12",
  file: path.relative(root, visualDirectory),
  passed: missingVisuals.length === 0,
  exists: visualFiles.length > 0,
  missingSymbols: missingVisuals,
  p15VisualCount: requiredVisuals.length - missingVisuals.length,
});

const inputContract = await readFile(path.join(root, "apps/studio-web/src/inspector-contract.ts"), "utf8");
const expressionFree =
  inputContract.includes("expressions are not allowed") && !inputContract.includes("eval(");
results.push({
  task: "P15.03-expression-boundary",
  file: "apps/studio-web/src/inspector-contract.ts",
  passed: expressionFree,
  exists: true,
  missingSymbols: expressionFree ? [] : ["strict expression-free parsing"],
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ passed, taskCount: 12, checks: results }, null, 2));
if (!passed) process.exitCode = 1;
