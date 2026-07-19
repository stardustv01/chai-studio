import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceGate } from "./run-acceptance-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await runAcceptanceGate({
  root,
  phase: "P24",
  taskRange: "P24.01-P24.12",
  contractName: "reliability-recovery-diagnostics-repair-contract",
  contractScript: "scripts/validate-p24-reliability-contract.mjs",
  extraChecks: [
    [
      "focused-recovery-fixtures",
      [
        [
          "./node_modules/.bin/vitest",
          [
            "run",
            "tests/unit/render-recovery.test.ts",
            "tests/unit/local-diagnostics-store.test.ts",
            "tests/integration/reliability-repair.test.ts",
            "tests/integration/project-backup-restore.test.ts",
          ],
        ],
      ],
    ],
  ],
  implementationFiles: [
    "package.json",
    "packages/render/src/recovery.ts",
    "packages/render/src/artifact-store.ts",
    "packages/render/src/encode.ts",
    "packages/render/src/index.ts",
    "apps/studio-server/src/local-diagnostics-store.ts",
    "apps/studio-server/src/reliability-service.ts",
    "apps/studio-server/src/render-service.ts",
    "apps/studio-server/src/index.ts",
    "apps/studio-web/src/api-client.ts",
    "apps/studio-web/src/use-studio-runtime.ts",
    "apps/studio-web/src/App.tsx",
    "docs/RECOVERY.md",
    "scripts/validate-p24-reliability-contract.mjs",
    "scripts/run-p24-gate.mjs",
    "tests/unit/render-recovery.test.ts",
    "tests/unit/local-diagnostics-store.test.ts",
    "tests/integration/reliability-repair.test.ts",
    "tests/integration/project-backup-restore.test.ts",
    "tests/integration/server-render-api.test.ts",
    "tests/integration/revision-store.test.ts",
    "tests/integration/autosave-recovery.test.ts",
    "tests/unit/server-worker-supervisor.test.ts",
    "tests/unit/render-dag-cache.test.ts",
    "tests/unit/render-encode-compositor.test.ts",
  ],
});
