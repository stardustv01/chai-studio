import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P21.01",
    "packages/render/src/delivery.ts",
    [
      "youtube-1080p",
      "youtube-4k",
      "review-proxy",
      "shorts",
      "square",
      "transparent-overlay",
      "master-mezzanine",
      "image-sequence",
      "audio-only",
      "createDeliveryProfile",
      "validateDeliveryProfile",
    ],
  ],
  [
    "P21.02",
    "packages/render/src/delivery.ts",
    ["full-timeline", "in-out", "selected-range", "clip", "frame", "named-version", "validateRenderScope"],
  ],
  [
    "P21.08",
    "packages/render/src/delivery.ts",
    [
      "delivery.dependencies.missing",
      "delivery.capability.unsupported",
      "delivery.rights.unresolved",
      "delivery.originals.missing",
      "delivery.disk.insufficient",
      "delivery.proxy.preview-only",
    ],
  ],
  [
    "P21.03-P21.05",
    "apps/studio-server/src/job-registry.ts",
    ["priority", "queueOrder", "stage", "activeEngine", "cacheHits", "reprioritize", "clearCompleted"],
  ],
  [
    "P21.03-P21.09",
    "apps/studio-server/src/render-service.ts",
    [
      "saveCustomProfile",
      "preflight",
      'renders", "queue", "requests',
      "persistedStatus",
      "Interrupted by restart",
      "pauseUnavailableReason",
      "duplicate",
      "reprioritize",
      "clearCompleted",
      "renderScope",
      "rendered_unchecked",
    ],
  ],
  [
    "P21.01-P21.09",
    "apps/studio-server/src/index.ts",
    [
      "/api/v1/renders/profiles",
      "/api/v1/renders/preflight",
      "/api/v1/renders/queue",
      "clear-completed",
      "duplicate|reprioritize",
    ],
  ],
  [
    "P21.01-P21.10",
    "apps/studio-web/src/delivery-workspace.tsx",
    [
      "DeliveryWorkspaceProvider",
      "Create custom profile",
      "Render range",
      "Render frame",
      "Render timeline",
      "Named version",
      "Retry failed stage",
      "Pause unavailable",
      "Reveal requires the native macOS shell bridge",
      "Show immutable receipt JSON",
      "Encoding success is never called delivery",
    ],
  ],
  [
    "P21.10",
    "tests/unit/render-delivery-profile.test.ts",
    ["required built-in delivery class", "invalid half-open ranges", "missing originals"],
  ],
  [
    "P21.03-P21.10",
    "tests/integration/server-render-api.test.ts",
    ["restart-safe queue authority", "restarted.queue", "clearCompleted", "rendered_unchecked"],
  ],
  [
    "P21.10",
    "tests/e2e/delivery-workspace.spec.ts",
    ["safe controls", "Contract preview is read-only", '"delivered": false', "p21-deliver-authority.png"],
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
  "tests/e2e/delivery-workspace.spec.ts-snapshots/p21-deliver-authority-darwin.png",
  "fixtures/goldens/checksum-manifest.json",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P21.10", file, passed: exists, exists, missingSymbols: [] });
}

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P21", taskRange: "P21.01-P21.10", passed, results }, null, 2));
if (!passed) process.exitCode = 1;
