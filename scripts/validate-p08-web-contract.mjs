import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tasks = [
  ["P08.01", "apps/studio-web/src/App.tsx", ["workspace-switcher", "ErrorBoundary"]],
  [
    "P08.02",
    "apps/studio-web/STATE_ARCHITECTURE.md",
    ["not a second project authority", "Authoritative project snapshot", "Query cache"],
  ],
  ["P08.03", "apps/studio-web/src/api-client.ts", ["StudioApiClient", "StaleRevisionError"]],
  ["P08.03", "apps/studio-web/src/event-stream.ts", ["last-event-id", "onResyncRequired"]],
  ["P08.04", "packages/ui-components/src/index.tsx", ["designTokens", "Button", "TextField", "ProgressBar"]],
  [
    "P08.05",
    "apps/studio-web/src/App.tsx",
    ["global-timecode", "Contract mock", "runtime.capture", "runtime.render"],
  ],
  [
    "P08.06",
    "apps/studio-web/src/layout-store.ts",
    ["defaultLayouts", "normalizeLayout", "saveWorkspaceLayout"],
  ],
  [
    "P08.07",
    "apps/studio-web/src/shortcuts.ts",
    ["coreShortcuts", "findShortcutConflicts", "isTextEntryTarget"],
  ],
  ["P08.08", "apps/studio-web/src/App.tsx", ["DiagnosticsDrawer", "ToastRegion", "No active diagnostic"]],
  ["P08.09", "apps/studio-web/src/types.ts", ["shellStateIds", "read-only", "conflict"]],
  ["P08.09", "apps/studio-web/src/App.tsx", ["ShellStateOverlay", "Retry and resync"]],
  ["P08.10", "apps/studio-web/src/performance.ts", ["LocalPerformanceMonitor", "long-task"]],
  ["P08.10", "apps/studio-web/src/App.tsx", ["react-commit", "eventLagMs"]],
];
const testFiles = [
  "tests/unit/web-api-client.test.ts",
  "tests/unit/web-event-stream.test.ts",
  "tests/unit/web-layout-shortcuts.test.ts",
  "tests/unit/ui-components.test.ts",
  "tests/e2e/local-shell.spec.ts",
  "tests/e2e/studio-visual.spec.ts",
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
for (const file of testFiles) {
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
  ...["edit", "inspect", "media", "animation", "deliver"].map(
    (workspace) => `p08-${workspace}-workspace-darwin.png`,
  ),
  ...["empty", "loading", "offline", "reconnecting", "migrating", "recovering", "read-only", "conflict"].map(
    (state) => `p08-state-${state}-darwin.png`,
  ),
];
const missingVisuals = requiredVisuals.filter((file) => !visualFiles.includes(file));
results.push({
  task: "visual-state-gallery",
  file: path.relative(root, visualDirectory),
  passed: visualFiles.length >= requiredVisuals.length && missingVisuals.length === 0,
  exists: visualFiles.length > 0,
  missingSymbols: missingVisuals,
  visualCount: visualFiles.length,
});

const workspaceSource = await readFile(path.join(root, "apps/studio-web/src/workspace-content.tsx"), "utf8");
const missingWorkspaces = ["edit", "inspect", "media", "animation", "deliver"].filter(
  (workspace) => !workspaceSource.includes(`workspace === "${workspace}"`) && workspace !== "edit",
);
results.push({
  task: "five-workspace-surface",
  file: "apps/studio-web/src/workspace-content.tsx",
  passed: missingWorkspaces.length === 0,
  exists: true,
  missingSymbols: missingWorkspaces,
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ passed, taskCount: 10, checks: results }, null, 2));
if (!passed) process.exitCode = 1;
