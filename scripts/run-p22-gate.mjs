import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceGate } from "./run-acceptance-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await runAcceptanceGate({
  root,
  phase: "P22",
  taskRange: "P22.01-P22.14",
  contractName: "qa-lifecycle-contract",
  contractScript: "scripts/validate-p22-qa-contract.mjs",
  extraChecks: [
    [
      "p22-normalized-pixel-and-perceptual-fixtures",
      [["node", ["scripts/validate-p22-visual-fixtures.mjs"]]],
    ],
  ],
  implementationFiles: [
    "package.json",
    "pnpm-lock.yaml",
    "packages/schema/src/project-validation.ts",
    "packages/qa/src/index.ts",
    "packages/qa/src/contracts.ts",
    "packages/qa/src/rules.ts",
    "packages/qa/src/preflight.ts",
    "packages/qa/src/evaluators.ts",
    "packages/qa/src/visual.ts",
    "packages/qa/src/language-sync.ts",
    "packages/qa/src/lifecycle.ts",
    "packages/qa/src/checklist.ts",
    "apps/studio-server/src/project-service.ts",
    "apps/studio-server/src/render-service.ts",
    "apps/studio-server/src/index.ts",
    "apps/studio-web/src/delivery-workspace.tsx",
    "apps/studio-web/src/styles.css",
    "fixtures/deterministic/qa/visual-fixtures.json",
    "fixtures/goldens/checksum-manifest.json",
    "scripts/qa-pixel-tools.mjs",
    "scripts/validate-p22-visual-fixtures.mjs",
    "scripts/validate-p22-qa-contract.mjs",
    "scripts/run-p22-gate.mjs",
    "tests/unit/qa-rules-lifecycle.test.ts",
    "tests/unit/qa-visual-sync.test.ts",
    "tests/integration/qa-lifecycle-authority.test.ts",
    "tests/integration/server-render-api.test.ts",
    "tests/e2e/qa-delivery-gate.spec.ts",
    "tests/e2e/qa-delivery-gate.spec.ts-snapshots/p22-qa-delivery-gate-darwin.png",
    "tests/e2e/delivery-workspace.spec.ts",
    "tests/e2e/delivery-workspace.spec.ts-snapshots/p21-deliver-authority-darwin.png",
  ],
});
