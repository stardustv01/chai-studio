import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tasks = [
  [
    "P14.01",
    "apps/studio-web/src/timeline-editor.tsx",
    ["visibleTracks", "firstVisibleTrack", "timeline-scroll", "timeline-top-row"],
  ],
  [
    "P14.02",
    "apps/studio-web/src/timeline-editor.tsx",
    ["rulerTicks", "formatTimecode", "timeline-playhead", "timeline-io-range"],
  ],
  [
    "P14.03",
    "apps/studio-web/src/timeline-editor.tsx",
    ["track.add", "track.remove", "track.update", "Remove ${track.name}"],
  ],
  [
    "P14.04",
    "apps/studio-web/src/timeline-editor.tsx",
    ["clip-engine", "clip-waveform", "clip-keyframes", "clip-bridge", "clip-warning"],
  ],
  [
    "P14.05",
    "apps/studio-web/src/timeline-editor.tsx",
    ["selection.set", "event.metaKey", "event.shiftKey", "aria-pressed"],
  ],
  [
    "P14.06",
    "apps/studio-web/src/timeline-editor.tsx",
    ["setPointerCapture", "deltaFrames", "clips.move", "timeline-snap-guide"],
  ],
  [
    "P14.07",
    "apps/studio-web/src/timeline-editor.tsx",
    ["clips.duplicate", "copyTimelineClips", "clips.paste", "clips.group", "clips.link"],
  ],
  [
    "P14.08",
    "apps/studio-web/src/timeline-editor.tsx",
    ["clips.split", "clips.trim", "clips.ripple-delete", "clips.lift", "clips.delete"],
  ],
  [
    "P14.09",
    "apps/studio-web/src/timeline-editor.tsx",
    ["Snap", "snapped", "timeline-snap-guide", "drag.deltaFrames"],
  ],
  [
    "P14.10",
    "apps/studio-web/src/timeline-editor.tsx",
    ["＋ Track", "Remove ${track.name}", "Timeline zoom", "Fit"],
  ],
  [
    "P14.11",
    "packages/timeline/src/derived-indexes.ts",
    ["searchTimelineIndex", "markersInFrameOrder", "searchTextByEntity", "queryNearbyClips"],
  ],
  [
    "P14.12",
    "apps/studio-web/src/timeline-editor.tsx",
    ["Search timeline", "assetId", "engine", "metadata", "matches"],
  ],
  [
    "P14.13",
    "apps/studio-web/src/use-studio-runtime.ts",
    ["timelineHistory", "moveTimelineHistory", "timeline-history", "history.${direction}", "baseRevisionId"],
  ],
  [
    "P14.14",
    "apps/studio-web/src/timeline-editor.tsx",
    ["timeline-context-menu", 'role="menu"', 'role="menuitem"'],
  ],
  [
    "P14.14",
    "apps/studio-web/src/shortcuts.ts",
    ["timeline.nudge-left", "timeline.delete", "timeline.split", "history.undo"],
  ],
  [
    "P14.15",
    "tests/e2e/timeline-editor.spec.ts",
    ["frame-exact", "keyboard commands", "command registry", "virtualize"],
  ],
  [
    "P14.16",
    "apps/studio-web/src/timeline-editor.tsx",
    ["aria-label", "aria-pressed", 'role="group"', "integer authority"],
  ],
  [
    "authority",
    "packages/schema/src/command-envelope.ts",
    ["timeline.edit", "TimelineEditCommand", "mutation"],
  ],
  [
    "authority",
    "packages/schema/src/command-engine.ts",
    ["applyTimelineEdit", "affected-entities.incomplete", "plannedRevisionId"],
  ],
  [
    "authority",
    "packages/timeline/src/document-adapter.ts",
    [
      "executeTimelineDocumentEdit",
      "timelineDocumentToSnapshot",
      "timelineSnapshotToDocument",
      "supportedOperationKinds",
      "marker.update",
    ],
  ],
  [
    "authority",
    "packages/schema/src/project-documents.ts",
    ["TimelineMarker", "readonly markers?", "annotationReferenceIds", "ripplePolicy"],
  ],
  [
    "authority",
    "apps/studio-server/src/project-service.ts",
    ["executeTimelineDocumentEdit", "applyTimelineEdit"],
  ],
  [
    "authority",
    "apps/studio-web/src/use-studio-runtime.ts",
    ["timelineCommandToJson", "timelineDocumentToSnapshot", "/api/v1/commands", "resync"],
  ],
];

const results = [];
for (const [task, file, symbols] of tasks) {
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

const requiredTests = [
  "tests/unit/timeline-document-adapter.test.ts",
  "tests/integration/timeline-document-command.test.ts",
  "tests/e2e/timeline-editor.spec.ts",
  "tests/e2e/studio-visual.spec.ts",
];
for (const file of requiredTests) {
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
const requiredVisuals = ["p14-timeline-editor-darwin.png", "p14-timeline-search-range-darwin.png"];
const missingVisuals = requiredVisuals.filter((file) => !visualFiles.includes(file));
results.push({
  task: "P14.15",
  file: path.relative(root, visualDirectory),
  passed: missingVisuals.length === 0,
  exists: visualFiles.length > 0,
  missingSymbols: missingVisuals,
  p14VisualCount: requiredVisuals.length - missingVisuals.length,
});

const sourceInspector = await readFile(
  path.join(root, "apps/studio-web/src/source-inspection-monitor.tsx"),
  "utf8",
);
const reserved = [
  />\s*Insert\s*</,
  />\s*Overwrite\s*</,
  />\s*Replace\s*</,
  />\s*Set source in\s*</,
  />\s*Set source out\s*</,
]
  .filter((pattern) => pattern.test(sourceInspector))
  .map((pattern) => pattern.source);
results.push({
  task: "P14-source-boundary",
  file: "apps/studio-web/src/source-inspection-monitor.tsx",
  passed: reserved.length === 0,
  exists: true,
  missingSymbols: reserved,
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ passed, taskCount: 16, checks: results }, null, 2));
if (!passed) process.exitCode = 1;
