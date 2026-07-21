import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvalIdentity,
  assertOwnerApproval,
  assertPublicDistributionReview,
  publicDistributionReviewIdentity,
  verifyAcceptanceGateReportIdentity,
  verifyManifestDocumentIdentity,
  verifySignedReleaseReceipt,
} from "./release-approval.mjs";
import { resolveReleaseTarget } from "./release-target.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFinalGate = process.argv.includes("--require-final-gate");
const results = [];
const packageManifest = await readJson("package.json");
const approval = await readJson("governance/V1_OWNER_APPROVAL.json");
const manifest = await readJson("evidence/p28/version-1-manifest.json");
const traceability = await readJson("evidence/p28/traceability-matrix.json");
const receipt = await readJson("evidence/p28/version-1-release-receipt.json");
const technicalGate = await readJson("evidence/p28-tech/gate-report.json");
const finalGate = await readJson("evidence/p28/gate-report.json");
const publicKey = await readText("evidence/p28/version-1-release-public-key.pem");
const dependencyInventory = await readJson("governance/licenses/dependency-inventory.json");
const distributionReview = await readJson("governance/licenses/public-distribution-review.json");
const dependencyInventoryText = await readText("governance/licenses/dependency-inventory.json");
const distributionReviewText = await readText("governance/licenses/public-distribution-review.json");
let target = null;
try {
  target = resolveReleaseTarget({ packageManifest });
} catch {
  // Captured as a failed contract result below.
}

let validatedApproval = null;
try {
  validatedApproval = assertOwnerApproval(approval);
} catch {
  // Captured as a failed contract result below.
}
const expectedApprovalIdentity = validatedApproval ? approvalIdentity(validatedApproval) : null;
results.push(result("explicit-owner-approval", validatedApproval !== null));
results.push(
  result(
    "owner-approval-target",
    validatedApproval !== null &&
      validatedApproval.version === target?.version &&
      validatedApproval.distribution === target?.distribution,
  ),
);
let validatedDistributionReview = null;
try {
  validatedDistributionReview = assertPublicDistributionReview(distributionReview, {
    version: target?.version,
    inventoryIdentity: dependencyInventory?.identityHash,
  });
} catch {
  // Captured as a failed contract result below.
}
results.push(result("public-distribution-review", validatedDistributionReview !== null));
const expectedDistributionReviewIdentity = validatedDistributionReview
  ? publicDistributionReviewIdentity(validatedDistributionReview, {
      version: target?.version,
      inventoryIdentity: dependencyInventory?.identityHash,
    })
  : null;
const expectedDependencyInventorySha256 = dependencyInventoryText
  ? createHash("sha256").update(dependencyInventoryText).digest("hex")
  : null;
const expectedDistributionReviewSha256 = distributionReviewText
  ? createHash("sha256").update(distributionReviewText).digest("hex")
  : null;
results.push(result("exact-source-identity", target !== null));
results.push(
  result(
    "complete-traceability",
    traceability?.rows?.length === 20 &&
      traceability.rows.every((row) => row.status === "passed") &&
      traceability?.unexplainedWaivers === 0 &&
      traceability?.unresolvedTechnicalBlockers === 0,
  ),
);
results.push(
  result(
    "immutable-version-manifest",
    manifest?.version === target?.version &&
      manifest?.releaseTag === target?.releaseTag &&
      manifest?.distribution === target?.distribution &&
      manifest?.releaseAuthorized === false &&
      manifest?.approvalIdentity === expectedApprovalIdentity &&
      manifest?.dependencyInventoryIdentity === dependencyInventory?.identityHash &&
      manifest?.dependencyInventorySha256 === expectedDependencyInventorySha256 &&
      manifest?.publicDistributionReviewIdentity === expectedDistributionReviewIdentity &&
      manifest?.publicDistributionReviewSha256 === expectedDistributionReviewSha256 &&
      verifyManifestDocumentIdentity(manifest ?? {}),
  ),
);
results.push(
  result(
    "passing-technical-gate",
    technicalGate?.passed === true &&
      verifyAcceptanceGateReportIdentity(technicalGate) &&
      receipt?.technicalGateIdentity === technicalGate?.identity,
  ),
);
results.push(
  result(
    "receipt-authority-chain",
    receipt?.version === target?.version &&
      receipt?.candidate === target?.version &&
      receipt?.distribution === target?.distribution &&
      receipt?.releaseAuthorized === true &&
      receipt?.releaseTagAuthorized === true &&
      receipt?.ownerApproval?.status === "explicitly-approved" &&
      receipt?.ownerApproval?.inferred === false &&
      receipt?.publicDistributionReview?.status === "approved-public-distribution" &&
      receipt?.ownerApproval?.approvalSha256 === expectedApprovalIdentity &&
      receipt?.dependencyInventoryIdentity === dependencyInventory?.identityHash &&
      receipt?.dependencyInventorySha256 === expectedDependencyInventorySha256 &&
      receipt?.publicDistributionReviewIdentity === expectedDistributionReviewIdentity &&
      receipt?.publicDistributionReviewSha256 === expectedDistributionReviewSha256 &&
      receipt?.publicDistributionReview?.inventoryIdentity === dependencyInventory?.identityHash &&
      receipt?.publicDistributionReview?.reviewIdentity === expectedDistributionReviewIdentity &&
      receipt?.finalManifestIdentity === manifest?.manifestIdentity &&
      receipt?.traceabilityIdentity === traceability?.identity &&
      receipt?.dependencyLockSha256 === manifest?.dependencyLockSha256,
  ),
);
const publicKeySha256 = publicKey ? createHash("sha256").update(publicKey).digest("hex") : null;
results.push(
  result(
    "ed25519-release-signature",
    Boolean(publicKey) &&
      receipt?.signature?.publicKeySha256 === publicKeySha256 &&
      verifySignedReleaseReceipt(receipt ?? {}, publicKey),
  ),
);
const finalGateBound =
  finalGate?.passed === true &&
  finalGate?.phase === "P28" &&
  verifyAcceptanceGateReportIdentity(finalGate ?? {}) &&
  receipt?.finalGateIdentity === finalGate?.identity;
results.push(
  result(
    "final-gate-binding",
    requireFinalGate ? finalGateBound : receipt?.finalGateIdentity === null || finalGateBound,
    requireFinalGate,
  ),
);

const passed = results.every((entry) => entry.passed);
console.log(
  JSON.stringify(
    {
      phase: "P28-FINAL",
      taskRange: "P28.01-P28.20",
      passed,
      requireFinalGate,
      results,
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;

function result(name, passed, required = true) {
  return { name, passed: Boolean(passed), required };
}

async function readJson(file) {
  const content = await readText(file);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function readText(file) {
  return readFile(path.join(root, file), "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
}
