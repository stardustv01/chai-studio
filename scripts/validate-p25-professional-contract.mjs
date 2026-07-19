import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P25.01-P25.03",
    "packages/timeline/src/professional.ts",
    ["clips.roll", "clip.slip", "clip.slide", "includeLinked", "timeline range fixed", "source handles"],
  ],
  [
    "P25.04",
    "packages/timeline/src/source-edit.ts",
    [
      "resolveThreePointEdit",
      "buildProfessionalSourceEdit",
      "timelineTransportUnchanged",
      "clip.insert",
      "clip.overwrite",
      "clip.replace",
    ],
  ],
  [
    "P25.05",
    "packages/timeline/src/professional.ts",
    ["compound.create", "compound.flatten", "NestedSequenceSnapshot", "dependencyIds", "childAutomation"],
  ],
  [
    "P25.06",
    "packages/timeline/src/professional.ts",
    ["ProfessionalTakeStack", "take.activate", "inactive takes", "reviewRevisionId"],
  ],
  [
    "P25.07-P25.09",
    "packages/timeline/src/professional.ts",
    [
      "clip.playback",
      "clip.speed",
      "clip.time-remap",
      "evaluateTimeRemapForPreview",
      "evaluateTimeRemapForRender",
      "monotonicPolicy",
      "NormalizedRational",
    ],
  ],
  [
    "P25.10,P25.14",
    "packages/timeline/src/professional.ts",
    [
      "AdjustmentLayerDefinition",
      "cross-engine-fallback",
      "affectedProfessionalCacheRanges",
      "bake_required",
    ],
  ],
  [
    "P25.11",
    "packages/timeline/src/professional.ts",
    [
      "AdvancedBridgeDefinition",
      "outgoingHandleFrames",
      "preRollFrames",
      "alpha",
      "audioEnvelope",
      "boundaryQa",
      "validateBridgeBoundarySamples",
    ],
  ],
  [
    "P25.12",
    "apps/studio-web/src/keyframe-editor.tsx",
    [
      "Multi-property curve selection",
      "Speed graph",
      "Tangent mode",
      "Distribute time",
      "Retime 90%",
      "Curve graph zoom",
    ],
  ],
  [
    "P25.13",
    "packages/audio/src/commands.ts",
    ["audio.crossfade.upsert", "audio.ducking.upsert", "audio.sync-anchor.upsert", "audio.automation.upsert"],
  ],
  ["P25.13", "packages/audio/src/meter-history.ts", ["AudioMeterHistory", "maximumPoints", "clippedSamples"]],
  [
    "P25.01-P25.14",
    "apps/studio-web/src/professional-edit-bar.tsx",
    ["Roll −1", "Slip −1", "Slide −1", "Speed curve", "Version stack", "Range effect"],
  ],
  [
    "P25.04",
    "apps/studio-web/src/source-inspection-monitor.tsx",
    ["Professional source", "Mark I", "Target track", "Apply three-point edit", "source clock unchanged"],
  ],
  [
    "P25.11",
    "apps/studio-web/src/bridge-editor-panel.tsx",
    ["Advanced bridge editor", "boundary QA", "No blank/duplicate frames", "Fallback"],
  ],
  [
    "P25.15",
    "tests/unit/professional-timeline.test.ts",
    [
      "rolls an adjacent boundary",
      "slips exact rational",
      "slides a clip",
      "creates and flattens",
      "uses one deterministic remap",
      "advanced bridge",
    ],
  ],
  [
    "P25.15",
    "tests/property/professional-edit.property.test.ts",
    ["numRuns: 100", "preserve total duration", "normalized rational"],
  ],
  [
    "P25.15",
    "tests/integration/professional-reopen-parity.test.ts",
    ["reopen parity", "professionalMetadata", "readProfessionalTimelineState"],
  ],
  [
    "P25.15",
    "tests/e2e/professional-editing.spec.ts",
    ["roll/slip/slide", "three-point", "advanced bridge", "expanded audio"],
  ],
  [
    "P25.15",
    "tests/e2e/studio-visual.spec.ts",
    [
      "P25 professional editing surfaces",
      "p25-professional-timeline.png",
      "p25-professional-source-monitor.png",
      "p25-advanced-bridge-editor.png",
    ],
  ],
  [
    "P25.01-P25.15",
    "docs/PROFESSIONAL_EDITING.md",
    [
      "Advanced trim",
      "Professional source monitor",
      "Compounds and versions",
      "Playback, speed, and remapping",
      "Adjustment layers",
      "Advanced bridges",
      "Curves and audio automation",
      "Persistence and recovery",
    ],
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
  "packages/timeline/src/professional.ts",
  "packages/timeline/src/source-edit.ts",
  "packages/audio/src/meter-history.ts",
  "apps/studio-web/src/professional-edit-bar.tsx",
  "apps/studio-web/src/bridge-editor-panel.tsx",
  "tests/e2e/studio-visual.spec.ts-snapshots/p25-professional-timeline-darwin.png",
  "tests/e2e/studio-visual.spec.ts-snapshots/p25-professional-source-monitor-darwin.png",
  "tests/e2e/studio-visual.spec.ts-snapshots/p25-advanced-bridge-editor-darwin.png",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P25.01-P25.15", file, passed: exists, exists, missingSymbols: [] });
}
const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P25", taskRange: "P25.01-P25.15", passed, results }, null, 2));
if (!passed) process.exitCode = 1;
