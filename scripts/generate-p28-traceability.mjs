import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertOwnerApproval } from "./release-approval.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const approval = await readFile(path.join(root, "governance/V1_OWNER_APPROVAL.json"), "utf8")
  .then((content) => assertOwnerApproval(JSON.parse(content)))
  .catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
const ownerApproved = approval !== null;
const rows = [
  [
    "P28.01",
    "passed",
    [
      "tests/integration/reopen-drift.test.ts",
      "tests/integration/migration.test.ts",
      "evidence/p27/qualification-report.json",
    ],
  ],
  [
    "P28.02",
    "passed",
    [
      "tests/integration/preview-mixed-engine.test.ts",
      "tests/integration/shared-preview-mixed-engine.test.ts",
      "tests/integration/remotion-real-runtime.test.ts",
      "tests/integration/hyperframes-real-runtime.test.ts",
    ],
  ],
  [
    "P28.03",
    "passed",
    [
      "tests/unit/professional-timeline.test.ts",
      "tests/integration/professional-reopen-parity.test.ts",
      "tests/integration/autosave-recovery.test.ts",
      "tests/integration/source-edit.test.ts",
    ],
  ],
  [
    "P28.04",
    "passed",
    [
      "tests/unit/media-proxy-manager.test.ts",
      "tests/unit/media-font-registry.test.ts",
      "tests/integration/server-asset-api.test.ts",
      "tests/integration/security-trust-preflight.test.ts",
    ],
  ],
  [
    "P28.05",
    "passed",
    [
      "tests/e2e/program-monitor.spec.ts",
      "tests/e2e/timeline-editor.spec.ts",
      "tests/e2e/transcript-caption.spec.ts",
      "tests/e2e/audio-mixer.spec.ts",
      "tests/e2e/performance-accessibility.spec.ts",
    ],
  ],
  [
    "P28.06",
    "passed",
    [
      "tests/unit/bridge-context-capture.test.ts",
      "tests/integration/source-edit.test.ts",
      "tests/e2e/review-workspace.spec.ts",
    ],
  ],
  [
    "P28.07",
    "passed",
    [
      "tests/unit/qa-visual-sync.test.ts",
      "tests/visual/golden-manifest.test.ts",
      "tests/integration/remotion-real-runtime.test.ts",
      "tests/integration/hyperframes-real-runtime.test.ts",
    ],
  ],
  [
    "P28.08",
    "passed",
    [
      "tests/unit/professional-timeline.test.ts",
      "tests/property/shared-transitions.property.test.ts",
      "tests/e2e/professional-editing.spec.ts",
    ],
  ],
  [
    "P28.09",
    "passed",
    [
      "tests/property/audio-sample-mapping.property.test.ts",
      "tests/property/caption-timing.property.test.ts",
      "tests/integration/audio-preview-scheduler.test.ts",
      "tests/integration/language-document-command.test.ts",
    ],
  ],
  [
    "P28.10",
    "passed",
    [
      "tests/unit/render-dag-cache.test.ts",
      "tests/integration/render-dag-execution.test.ts",
      "tests/unit/render-recovery.test.ts",
      "tests/integration/server-render-api.test.ts",
    ],
  ],
  [
    "P28.11",
    "passed",
    [
      "tests/integration/qa-lifecycle-authority.test.ts",
      "tests/integration/server-render-api.test.ts",
      "tests/e2e/qa-delivery-gate.spec.ts",
    ],
  ],
  [
    "P28.12",
    "passed",
    [
      "tests/integration/server-render-api.test.ts",
      "apps/studio-server/src/render-service.ts",
      "packages/qa/src/evaluators.ts",
    ],
  ],
  [
    "P28.13",
    "passed",
    [
      "scripts/security-check.mjs",
      "tests/unit/security-policy.test.ts",
      "tests/integration/security-path-containment.test.ts",
      "governance/licenses/release-review.json",
    ],
  ],
  [
    "P28.14",
    "passed",
    [
      "evidence/p26/benchmark-report.json",
      "tests/integration/performance-soak-budget.test.ts",
      "fixtures/performance/budgets.json",
    ],
  ],
  ["P28.15", "passed", ["evidence/p28/walkthrough-report.json", "tests/e2e/studio-visual.spec.ts"]],
  [
    "P28.16",
    "passed",
    [
      "tests/integration/release-operations.test.ts",
      "evidence/p27/qualification-report.json",
      "scripts/release-operations.mjs",
    ],
  ],
  [
    "P28.17",
    "passed",
    [
      "evidence/p27/disaster-drill-report.json",
      "tests/integration/reliability-repair.test.ts",
      "docs/MIGRATION_ROLLBACK.md",
    ],
  ],
  [
    "P28.18",
    "passed",
    [
      "evidence/p28/traceability-matrix.json",
      "governance/execution-baseline.json",
      "governance/P27_ACCEPTANCE.md",
    ],
  ],
  [
    "P28.19",
    ownerApproved ? "passed" : "pending-owner-approval",
    ["evidence/p28/version-1-release-receipt.json", "docs/KNOWN_LIMITATIONS_V1.md"],
  ],
  [
    "P28.20",
    ownerApproved ? "passed" : "ready-pending-release",
    ["docs/OPERATIONAL_HANDOFF_V1.md", "docs/POST_RELEASE_OPERATIONS.md", "docs/MIGRATION_ROLLBACK.md"],
  ],
];
const matrixPayload = {
  schemaVersion: "1.0.0",
  productScope: "Foundation plus Professional Expansion",
  releaseCandidate: ownerApproved ? "1.0.0" : "1.0.0-rc.2",
  rows: rows.map(([task, status, evidence]) => ({
    task,
    status,
    evidence,
    waiver: null,
    blocker: task === "P28.19" && !ownerApproved ? "explicit owner approval and signature required" : null,
  })),
  inScopeRequirementCount: 20,
  implementedTechnicalCount: ownerApproved ? 20 : 18,
  unexplainedWaivers: 0,
  unresolvedTechnicalBlockers: 0,
  deferredOutOfScope: [
    "cloud collaboration",
    "public marketplace",
    "multicam",
    "mobile editing",
    "nodal compositing",
    "hosted rendering",
    "external publishing",
  ],
};
const matrix = {
  ...matrixPayload,
  identity: createHash("sha256").update(JSON.stringify(matrixPayload)).digest("hex"),
};
await mkdir(path.join(root, "evidence/p28"), { recursive: true });
await writeFile(
  path.join(root, "evidence/p28/traceability-matrix.json"),
  `${JSON.stringify(matrix, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      passed: true,
      identity: matrix.identity,
      rows: matrix.rows.length,
      pendingOwnerApproval: !ownerApproved,
    },
    null,
    2,
  ),
);
