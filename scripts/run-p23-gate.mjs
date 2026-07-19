import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceGate } from "./run-acceptance-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await runAcceptanceGate({
  root,
  phase: "P23",
  taskRange: "P23.01-P23.14",
  contractName: "security-privacy-isolation-license-contract",
  contractScript: "scripts/validate-p23-security-contract.mjs",
  extraChecks: [
    [
      "macos-adversarial-isolation",
      [
        ["node", ["spikes/milestone-0/scripts/run-isolation-spike.mjs"]],
        ["node", ["scripts/validate-p23-isolation-evidence.mjs"]],
      ],
    ],
    [
      "dependency-license-inventory",
      [
        ["node", ["scripts/generate-p23-license-inventory.mjs", "--check"]],
        ["node", ["scripts/validate-p23-release-review.mjs"]],
      ],
    ],
  ],
  implementationFiles: [
    "package.json",
    "pnpm-lock.yaml",
    "packages/security/package.json",
    "packages/security/src/contracts.ts",
    "packages/security/src/identity.ts",
    "packages/security/src/policy.ts",
    "packages/security/src/path-policy.ts",
    "packages/security/src/network-policy.ts",
    "packages/security/src/environment-policy.ts",
    "packages/security/src/browser-policy.ts",
    "packages/security/src/worker-isolation.ts",
    "packages/security/src/authorization.ts",
    "packages/security/src/index.ts",
    "packages/diagnostics/src/index.ts",
    "packages/bridge/src/redaction.ts",
    "packages/engine-adapters/src/hyperframes/contracts.ts",
    "packages/engine-adapters/src/hyperframes/inspector.ts",
    "apps/studio-server/src/request-security.ts",
    "apps/studio-server/src/render-service.ts",
    "apps/studio-server/src/index.ts",
    "apps/studio-web/src/api-client.ts",
    "governance/P23_THREAT_MODEL.md",
    "governance/licenses/dependency-inventory.json",
    "governance/licenses/release-review.json",
    "scripts/generate-p23-license-inventory.mjs",
    "scripts/validate-p23-release-review.mjs",
    "scripts/validate-p23-security-contract.mjs",
    "scripts/validate-p23-isolation-evidence.mjs",
    "scripts/run-p23-gate.mjs",
    "tests/unit/security-policy.test.ts",
    "tests/unit/server-request-security.test.ts",
    "tests/integration/security-path-containment.test.ts",
    "tests/integration/security-server-boundary.test.ts",
    "tests/integration/security-trust-preflight.test.ts",
    "tests/integration/server-render-api.test.ts",
    "tests/property/redaction.property.test.ts",
  ],
});
