import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceGate } from "./run-acceptance-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await runAcceptanceGate({
  root,
  phase: "P28-TECH",
  taskRange: "P28.01-P28.20-preapproval",
  contractName: "final-technical-acceptance-contract",
  contractScript: "scripts/validate-p28-technical-contract.mjs",
  extraChecks: [
    [
      "final-cross-system-fixtures",
      [
        [
          "./node_modules/.bin/vitest",
          [
            "run",
            "tests/integration/reopen-drift.test.ts",
            "tests/integration/migration.test.ts",
            "tests/integration/autosave-recovery.test.ts",
            "tests/integration/source-edit.test.ts",
            "tests/integration/preview-mixed-engine.test.ts",
            "tests/integration/shared-preview-mixed-engine.test.ts",
            "tests/integration/professional-reopen-parity.test.ts",
            "tests/integration/server-asset-api.test.ts",
            "tests/integration/server-render-api.test.ts",
            "tests/integration/render-dag-execution.test.ts",
            "tests/integration/qa-lifecycle-authority.test.ts",
            "tests/integration/audio-preview-scheduler.test.ts",
            "tests/integration/language-document-command.test.ts",
            "tests/integration/security-path-containment.test.ts",
            "tests/integration/performance-soak-budget.test.ts",
            "tests/unit/bridge-context-capture.test.ts",
            "tests/unit/qa-visual-sync.test.ts",
            "tests/unit/professional-timeline.test.ts",
            "tests/unit/render-dag-cache.test.ts",
            "tests/unit/render-recovery.test.ts",
            "tests/unit/security-policy.test.ts",
          ],
        ],
      ],
    ],
    [
      "final-preservation-recovery",
      [
        [
          "./node_modules/.bin/vitest",
          [
            "run",
            "tests/integration/release-operations.test.ts",
            "tests/integration/project-backup-restore.test.ts",
            "tests/integration/reliability-repair.test.ts",
          ],
        ],
        ["node", ["scripts/run-p27-qualification.mjs"]],
        ["node", ["scripts/generate-p27-disaster-report.mjs"]],
      ],
    ],
    [
      "final-walkthrough-traceability",
      [
        ["node", ["scripts/generate-p28-walkthrough-report.mjs"]],
        ["node", ["scripts/generate-p28-traceability.mjs"]],
        ["node", ["scripts/prepare-p28-release-receipt.mjs"]],
        ["node", ["scripts/validate-p28-technical-contract.mjs"]],
      ],
    ],
  ],
  implementationFiles: [
    "packages/diagnostics/src/release-identity.json",
    "scripts/release-approval.mjs",
    "scripts/release-approval.d.mts",
    "scripts/release-target.mjs",
    "scripts/release-target.d.mts",
    "scripts/release-operations.mjs",
    "scripts/release-operations.d.mts",
    "tests/integration/release-operations.test.ts",
    "docs/KNOWN_LIMITATIONS_V1.md",
    "docs/OPERATIONAL_HANDOFF_V1.md",
    "scripts/generate-p28-walkthrough-report.mjs",
    "scripts/generate-p28-traceability.mjs",
    "scripts/prepare-p28-release-receipt.mjs",
    "scripts/validate-p28-technical-contract.mjs",
    "scripts/run-p28-technical-gate.mjs",
  ],
});
