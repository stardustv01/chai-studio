import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseTarget } from "./release-target.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = await readJson("package.json");
const target = resolveReleaseTarget({ packageManifest });
const checks = [
  [
    "P28.01-P28.03",
    "evidence/p28/traceability-matrix.json",
    [
      "reopen-drift.test.ts",
      "preview-mixed-engine.test.ts",
      "professional-reopen-parity.test.ts",
      "autosave-recovery.test.ts",
    ],
  ],
  [
    "P28.04-P28.06",
    "evidence/p28/traceability-matrix.json",
    ["media-proxy-manager.test.ts", "program-monitor.spec.ts", "bridge-context-capture.test.ts"],
  ],
  [
    "P28.07-P28.09",
    "evidence/p28/traceability-matrix.json",
    [
      "qa-visual-sync.test.ts",
      "shared-transitions.property.test.ts",
      "audio-sample-mapping.property.test.ts",
    ],
  ],
  [
    "P28.10-P28.12",
    "evidence/p28/traceability-matrix.json",
    ["render-dag-cache.test.ts", "qa-lifecycle-authority.test.ts", "server-render-api.test.ts"],
  ],
  [
    "P28.13-P28.14",
    "evidence/p28/traceability-matrix.json",
    ["security-check.mjs", "performance-soak-budget.test.ts", "benchmark-report.json"],
  ],
  [
    "P28.15",
    "scripts/generate-p28-walkthrough-report.mjs",
    ["attendanceDoesNotImplyApproval", "ownerApprovalInferred", "unresolvedFindings"],
  ],
  [
    "P28.16",
    "scripts/release-operations.mjs",
    ["validateBackupEnvironment", "explicit-environment-incompatibility", "outputReproductionAllowed"],
  ],
  ["P28.17", "docs/MIGRATION_ROLLBACK.md", ["Rollback", "immutable release", "irreversible boundary"]],
  [
    "P28.18",
    "scripts/generate-p28-traceability.mjs",
    ["unexplainedWaivers", "unresolvedTechnicalBlockers", "Foundation plus Professional Expansion"],
  ],
  [
    "P28.19",
    "scripts/prepare-p28-release-receipt.mjs",
    ["pending-explicit-owner-approval", "releaseAuthorized: false", "signature: null"],
  ],
  ["P28.19", "docs/KNOWN_LIMITATIONS_V1.md", ["measured support", "personal use", "pending"]],
  [
    "P28.20",
    "docs/OPERATIONAL_HANDOFF_V1.md",
    ["rollback", "support", "Final authority", "not release approval"],
  ],
];
const results = [];
for (const [task, file, symbols] of checks) {
  const content = await readFile(path.join(root, file), "utf8").catch(() => "");
  const missingSymbols = symbols.filter((symbol) => !content.includes(symbol));
  results.push({
    task,
    file,
    passed: content.length > 0 && missingSymbols.length === 0,
    exists: content.length > 0,
    missingSymbols,
  });
}

const walkthrough = await readJson("evidence/p28/walkthrough-report.json");
results.push({
  task: "P28.15",
  file: "evidence/p28/walkthrough-report.json",
  passed:
    walkthrough?.passed === true &&
    walkthrough?.areas?.length === 8 &&
    walkthrough?.unresolvedFindings?.length === 0 &&
    walkthrough?.ownerApprovalInferred === false,
  exists: walkthrough !== null,
  missingSymbols: [],
});
const traceability = await readJson("evidence/p28/traceability-matrix.json");
const traceStatuses = Array.isArray(traceability?.rows) ? traceability.rows.map((row) => row.status) : [];
results.push({
  task: "P28.18",
  file: "evidence/p28/traceability-matrix.json",
  passed:
    traceability?.rows?.length === 20 &&
    traceStatuses.filter((status) => status === "passed").length === 18 &&
    traceability?.unexplainedWaivers === 0 &&
    traceability?.unresolvedTechnicalBlockers === 0,
  exists: traceability !== null,
  missingSymbols: [],
});
const receipt = await readJson("evidence/p28/version-1-release-receipt.json");
const publicReviewStatus = receipt?.publicDistributionReview?.status;
results.push({
  task: "P28.19-P28.20",
  file: "evidence/p28/version-1-release-receipt.json",
  passed:
    receipt?.version === target.version &&
    receipt?.candidate === target.version &&
    receipt?.distribution === target.distribution &&
    receipt?.ownerApproval?.status === "pending-explicit-owner-approval" &&
    receipt?.ownerApproval?.inferred === false &&
    ["pending-public-distribution-review", "approved-public-distribution"].includes(publicReviewStatus) &&
    receipt?.signature === null &&
    receipt?.releaseAuthorized === false,
  exists: receipt !== null,
  missingSymbols: [],
});
const passed = results.every((result) => result.passed);
console.log(
  JSON.stringify(
    {
      phase: "P28-TECHNICAL",
      taskRange: "P28.01-P28.20-preapproval",
      passed,
      ownerApprovalRequired: true,
      results,
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;

async function readJson(file) {
  return readFile(path.join(root, file), "utf8")
    .then((content) => JSON.parse(content))
    .catch(() => null);
}
