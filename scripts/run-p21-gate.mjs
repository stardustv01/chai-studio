import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceGate } from "./run-acceptance-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await runAcceptanceGate({
  root,
  phase: "P21",
  taskRange: "P21.01-P21.10",
  contractName: "delivery-contract",
  contractScript: "scripts/validate-p21-delivery-contract.mjs",
  implementationFiles: [
    "package.json",
    "pnpm-lock.yaml",
    "packages/render/src/index.ts",
    "packages/render/src/delivery.ts",
    "apps/studio-server/src/job-registry.ts",
    "apps/studio-server/src/render-service.ts",
    "apps/studio-server/src/index.ts",
    "apps/studio-web/src/App.tsx",
    "apps/studio-web/src/workspace-content.tsx",
    "apps/studio-web/src/delivery-workspace.tsx",
    "apps/studio-web/src/styles.css",
    "fixtures/goldens/checksum-manifest.json",
    "scripts/validate-p21-delivery-contract.mjs",
    "scripts/run-p21-gate.mjs",
    "tests/unit/render-delivery-profile.test.ts",
    "tests/unit/server-job-registry.test.ts",
    "tests/integration/server-render-api.test.ts",
    "tests/e2e/delivery-workspace.spec.ts",
    "tests/e2e/delivery-workspace.spec.ts-snapshots/p21-deliver-authority-darwin.png",
    "tests/e2e/studio-visual.spec.ts-snapshots/p08-deliver-workspace-darwin.png",
  ],
});
