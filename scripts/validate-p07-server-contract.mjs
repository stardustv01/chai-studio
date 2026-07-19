import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tasks = [
  [
    "P07.01",
    "apps/studio-server/src/request-security.ts",
    ["assertLoopbackBindHost", "authorizeStudioRequest"],
  ],
  ["P07.02", "apps/studio-server/src/api-contract.ts", ["studioApiVersion", "ApiErrorEnvelope"]],
  ["P07.03", "apps/studio-server/src/project-service.ts", ["ProjectSessionService", "repairReport"]],
  ["P07.04", "packages/schema/src/command-engine.ts", ["executeProjectCommand", "history.undo"]],
  ["P07.05", "apps/studio-server/src/asset-service.ts", ["enqueueInspection", "invalidateAssetCaches"]],
  ["P07.06", "apps/studio-server/src/preview-service.ts", ["PreviewSessionService", "preload"]],
  [
    "P07.07",
    "apps/studio-server/src/interaction-service.ts",
    ["StudioInteractionService", "commitSourceEdit"],
  ],
  ["P07.08", "apps/studio-server/src/render-service.ts", ["RenderApiService", "RenderReceiptBase"]],
  ["P07.09", "apps/studio-server/src/event-hub.ts", ["StudioEventHub", "formatStudioServerSentEvent"]],
  ["P07.10", "apps/studio-server/src/worker-supervisor.ts", ["WorkerSupervisor", "workerRpcProtocolVersion"]],
  ["P07.11", "apps/studio-server/src/regenerable-index.ts", ["RegenerableStudioIndex", "authority: false"]],
  ["P07.12", "apps/studio-server/src/runtime-hygiene.ts", ["RuntimeHygieneService", "shutdown"]],
];
const testFiles = [
  "tests/integration/server-health.test.ts",
  "tests/integration/server-project-api.test.ts",
  "tests/integration/server-command-api.test.ts",
  "tests/integration/server-asset-api.test.ts",
  "tests/integration/server-preview-api.test.ts",
  "tests/integration/server-interaction-api.test.ts",
  "tests/integration/server-render-api.test.ts",
  "tests/integration/server-events-api.test.ts",
  "tests/unit/server-worker-supervisor.test.ts",
  "tests/integration/server-regenerable-index.test.ts",
  "tests/integration/server-runtime-hygiene.test.ts",
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
const indexSource = await readFile(path.join(root, "apps/studio-server/src/index.ts"), "utf8");
const routes = [
  "/api/v1/projects",
  "/api/v1/commands",
  "/api/v1/assets",
  "/api/v1/preview",
  "/api/v1/editor",
  "/api/v1/captures",
  "/api/v1/annotations",
  "/api/v1/comparisons",
  "/api/v1/source-edits",
  "/api/v1/renders",
  "/api/v1/events",
  "/api/v1/index",
  "/api/v1/runtime",
];
const missingRoutes = routes.filter((route) => !indexSource.includes(route));
results.push({
  task: "versioned-route-surface",
  file: "apps/studio-server/src/index.ts",
  passed: missingRoutes.length === 0,
  exists: true,
  missingSymbols: missingRoutes,
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ passed, taskCount: tasks.length, checks: results }, null, 2));
if (!passed) process.exitCode = 1;
