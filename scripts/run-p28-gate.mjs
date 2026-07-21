import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceGate } from "./run-acceptance-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await runAcceptanceGate({
  root,
  phase: "P28",
  taskRange: "P28.01-P28.20",
  contractName: "final-release-acceptance-contract",
  contractScript: "scripts/validate-p28-final-contract.mjs",
  extraChecks: [
    ["version-1-manifest-drift", [["node", ["scripts/generate-p28-version-manifest.mjs", "--check"]]]],
    [
      "release-authorization-negative-tests",
      [["./node_modules/.bin/vitest", ["run", "tests/unit/final-release-authorization.test.ts"]]],
    ],
  ],
  implementationFiles: [
    "package.json",
    "packages/diagnostics/src/release.ts",
    "packages/diagnostics/src/release-identity.json",
    ".github/workflows/ci.yml",
    "governance/V1_OWNER_APPROVAL.json",
    "governance/templates/V1_OWNER_APPROVAL.example.json",
    "governance/templates/PUBLIC_DISTRIBUTION_REVIEW.example.json",
    "governance/licenses/public-distribution-review.json",
    "scripts/release-approval.mjs",
    "scripts/release-approval.d.mts",
    "scripts/release-target.mjs",
    "scripts/release-target.d.mts",
    "scripts/validate-release-tag.mjs",
    "scripts/validate-release-tag.d.mts",
    "scripts/generate-p28-version-manifest.mjs",
    "scripts/generate-p28-traceability.mjs",
    "scripts/prepare-p28-release-receipt.mjs",
    "scripts/sign-p28-release.mjs",
    "scripts/validate-p28-final-contract.mjs",
    "scripts/run-p28-gate.mjs",
    "tests/unit/final-release-authorization.test.ts",
    "docs/KNOWN_LIMITATIONS_V1.md",
    "docs/OPERATIONAL_HANDOFF_V1.md",
  ],
});
