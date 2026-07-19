import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceGate } from "./run-acceptance-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await runAcceptanceGate({
  root,
  phase: "P20",
  taskRange: "P20.01-P20.16",
  contractName: "render-contract",
  contractScript: "scripts/validate-p20-render-contract.mjs",
  implementationFiles: [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "apps/studio-server/package.json",
    "apps/studio-server/tsconfig.json",
    "apps/studio-server/src/render-service.ts",
    "packages/render/package.json",
    "packages/render/tsconfig.json",
    "packages/render/src/index.ts",
    "packages/render/src/contracts.ts",
    "packages/render/src/dag.ts",
    "packages/render/src/identity.ts",
    "packages/render/src/artifact-store.ts",
    "packages/render/src/planning.ts",
    "packages/render/src/bridge-scene.ts",
    "packages/render/src/execution.ts",
    "packages/render/src/progress.ts",
    "packages/render/src/scheduler.ts",
    "packages/render/src/encode.ts",
    "packages/render/src/remotion-compositor.ts",
    "packages/render/src/nodes.ts",
    "scripts/validate-p20-render-contract.mjs",
    "scripts/run-acceptance-gate.mjs",
    "scripts/run-p20-gate.mjs",
    "tests/unit/render-dag-cache.test.ts",
    "tests/unit/render-scheduler-progress.test.ts",
    "tests/unit/render-encode-compositor.test.ts",
    "tests/property/render-cache-invalidation.property.test.ts",
    "tests/integration/render-dag-execution.test.ts",
    "tests/integration/server-render-api.test.ts",
  ],
});
