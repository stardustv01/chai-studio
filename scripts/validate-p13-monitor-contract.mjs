import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tasks = [
  [
    "P13.01",
    "apps/studio-web/src/monitor-contract.ts",
    ["calculateMonitorViewport", "mapMonitorPointToComposition", "backingWidth", "pillarbox"],
  ],
  [
    "P13.01",
    "apps/studio-web/src/program-monitor.tsx",
    ["ResizeObserver", "devicePixelRatio", "monitor-viewport--checker", "panOrigin"],
  ],
  [
    "P13.02",
    "apps/studio-web/src/monitor-contract.ts",
    ["monitorTruthPresentation", "Interactive approximation", "Baked fallback", "droppedFrameLabel"],
  ],
  [
    "P13.03",
    "apps/studio-web/src/monitor-contract.ts",
    ["previewControlRequests", "step-second", "seek-start", "toggle-loop", "shuttle"],
  ],
  [
    "P13.03",
    "apps/studio-web/src/shortcuts.ts",
    ["transport.previous-frame", "transport.next-second", "transport.mark-in", "transport.shuttle-forward"],
  ],
  [
    "P13.04",
    "apps/studio-web/src/program-monitor.tsx",
    ["Title and action safe", "Thirds grid", "Custom guides", "Include review overlays"],
  ],
  [
    "P13.05",
    "apps/studio-web/src/program-monitor.tsx",
    ["requestFullscreen", "fullscreenchange", "Exit fullscreen monitor"],
  ],
  [
    "P13.06",
    "apps/studio-web/src/program-monitor.tsx",
    ["interactive-frame", "exact-fidelity", "isolated-clip", "before-effects", "contact-sheet"],
  ],
  [
    "P13.07",
    "apps/studio-web/src/program-monitor.tsx",
    ["split", "wipe", "onion", "difference", "Monitor artifact identity"],
  ],
  [
    "P13.08",
    "apps/studio-web/src/source-inspection-monitor.tsx",
    ["video", "image", "remotion", "hyperframes", "Independent source frame", "timeline remains frame"],
  ],
  [
    "P13.09",
    "apps/studio-web/src/monitor-contract.ts",
    ["foundationSourceInspectionActions", "forbiddenFoundationSourceActions", "reset-audition"],
  ],
  [
    "P13.10",
    "apps/studio-web/src/program-monitor.tsx",
    ["Program monitor context menu", "Keyboard help", "aria-label", "Pointer outside composition"],
  ],
  [
    "P13.11",
    "tests/e2e/program-monitor.spec.ts",
    ["capture modes", "comparison modes", "independent clock", "fullscreen"],
  ],
  [
    "P13.12",
    "tests/unit/web-monitor-contract.test.ts",
    ["normalizedX", "sourceX", "high-DPI", "pan and zoom"],
  ],
];
const requiredTests = [
  "tests/unit/web-monitor-contract.test.ts",
  "tests/e2e/program-monitor.spec.ts",
  "tests/e2e/studio-visual.spec.ts",
];
const requiredVisuals = [
  "p13-program-monitor-edit-darwin.png",
  "p13-program-monitor-overlays-darwin.png",
  "p13-program-monitor-difference-darwin.png",
  "p13-source-monitor-remotion-darwin.png",
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
const missingVisuals = requiredVisuals.filter((file) => !visualFiles.includes(file));
results.push({
  task: "P13.11",
  file: path.relative(root, visualDirectory),
  passed: missingVisuals.length === 0,
  exists: visualFiles.length > 0,
  missingSymbols: missingVisuals,
  p13VisualCount: requiredVisuals.length - missingVisuals.length,
});

const sourceInspector = await readFile(
  path.join(root, "apps/studio-web/src/source-inspection-monitor.tsx"),
  "utf8",
);
const forbiddenButtonPatterns = [
  />\s*Insert\s*</,
  />\s*Overwrite\s*</,
  />\s*Replace\s*</,
  />\s*Set source in\s*</,
  />\s*Set source out\s*</,
];
const exposedReservedControls = forbiddenButtonPatterns
  .filter((pattern) => pattern.test(sourceInspector))
  .map((pattern) => pattern.source);
results.push({
  task: "P13.09-boundary",
  file: "apps/studio-web/src/source-inspection-monitor.tsx",
  passed: exposedReservedControls.length === 0,
  exists: true,
  missingSymbols: exposedReservedControls,
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ passed, taskCount: 12, checks: results }, null, 2));
if (!passed) process.exitCode = 1;
