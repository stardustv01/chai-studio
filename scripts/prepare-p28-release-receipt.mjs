import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvalIdentity,
  assertOwnerApproval,
  assertPublicDistributionReview,
  publicDistributionReviewIdentity,
  verifyManifestDocumentIdentity,
} from "./release-approval.mjs";
import { resolveReleaseTarget } from "./release-target.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p27 = JSON.parse(await readFile(path.join(root, "evidence/p27/gate-report.json"), "utf8"));
const p27Manifest = JSON.parse(await readFile(path.join(root, "evidence/p27/release-manifest.json"), "utf8"));
const finalManifest = await readJson("evidence/p28/version-1-manifest.json");
const approval = await readFile(path.join(root, "governance/V1_OWNER_APPROVAL.json"), "utf8")
  .then((content) => assertOwnerApproval(JSON.parse(content)))
  .catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
const traceability = JSON.parse(
  await readFile(path.join(root, "evidence/p28/traceability-matrix.json"), "utf8"),
);
const technicalGate = await readFile(path.join(root, "evidence/p28-tech/gate-report.json"), "utf8")
  .then((content) => JSON.parse(content))
  .catch(() => null);
const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const target = resolveReleaseTarget({ packageManifest });
if (approval && (approval.version !== target.version || approval.distribution !== target.distribution)) {
  throw new Error("Owner approval does not match the exact release target.");
}
const dependencyInventoryBytes = await readFile(
  path.join(root, "governance/licenses/dependency-inventory.json"),
);
const dependencyInventory = JSON.parse(dependencyInventoryBytes.toString("utf8"));
const distributionReviewBytes = await readFile(
  path.join(root, "governance/licenses/public-distribution-review.json"),
).catch((error) => {
  if (error?.code === "ENOENT") return null;
  throw error;
});
const distributionReview = distributionReviewBytes
  ? assertPublicDistributionReview(JSON.parse(distributionReviewBytes.toString("utf8")), {
      version: target.version,
      inventoryIdentity: dependencyInventory.identityHash,
    })
  : null;
const distributionReviewIdentity = distributionReview
  ? publicDistributionReviewIdentity(distributionReview, {
      version: target.version,
      inventoryIdentity: dependencyInventory.identityHash,
    })
  : null;
const dependencyInventorySha256 = createHash("sha256").update(dependencyInventoryBytes).digest("hex");
const distributionReviewSha256 = distributionReviewBytes
  ? createHash("sha256").update(distributionReviewBytes).digest("hex")
  : null;
if (
  finalManifest !== null &&
  (!verifyManifestDocumentIdentity(finalManifest) ||
    finalManifest.dependencyInventoryIdentity !== dependencyInventory.identityHash ||
    finalManifest.dependencyInventorySha256 !== dependencyInventorySha256 ||
    finalManifest.publicDistributionReviewIdentity !== distributionReviewIdentity ||
    finalManifest.publicDistributionReviewSha256 !== distributionReviewSha256)
) {
  throw new Error("Final manifest does not match the exact dependency and distribution-review evidence.");
}
const payload = {
  schemaVersion: "1.0.0",
  product: "Chai Studio",
  version: target.version,
  candidate: target.version,
  distribution: target.distribution,
  sourceGateIdentity: p27.identity,
  releaseManifestIdentity: p27Manifest.manifestIdentity,
  finalManifestIdentity: finalManifest?.manifestIdentity ?? null,
  traceabilityIdentity: traceability.identity,
  technicalGateIdentity: technicalGate?.identity ?? null,
  technicalGatePassed: technicalGate?.passed === true,
  dependencyLockSha256: finalManifest?.dependencyLockSha256 ?? p27Manifest.dependencyLockSha256,
  dependencyInventoryIdentity: dependencyInventory.identityHash,
  dependencyInventorySha256,
  publicDistributionReviewIdentity: distributionReviewIdentity,
  publicDistributionReviewSha256: distributionReviewSha256,
  supportClass: "apple-m4-16gb",
  environmentFingerprint: "bdb45e80a3ead9eb4ab04b4e79d16fc81738e4add1b763f8e17cd3db9d02313a",
  knownLimitations: "docs/KNOWN_LIMITATIONS_V1.md",
  operationalHandoff: "docs/OPERATIONAL_HANDOFF_V1.md",
  ownerApproval: approval
    ? {
        status: "explicit-approval-validated-pending-signature",
        inferred: false,
        evidence: "governance/V1_OWNER_APPROVAL.json",
        approvalSha256: approvalIdentity(approval),
      }
    : { status: "pending-explicit-owner-approval", inferred: false, evidence: null },
  publicDistributionReview:
    distributionReview === null
      ? { status: "pending-public-distribution-review", evidence: null }
      : {
          status: "approved-public-distribution",
          evidence: "governance/licenses/public-distribution-review.json",
          inventoryIdentity: distributionReview.inventoryIdentity,
          reviewIdentity: distributionReviewIdentity,
        },
  finalGateIdentity: null,
  signature: null,
  releaseAuthorized: false,
  releaseTagAuthorized: false,
};
const receipt = {
  ...payload,
  candidateIdentity: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
};
await mkdir(path.join(root, "evidence/p28"), { recursive: true });
await writeFile(
  path.join(root, "evidence/p28/version-1-release-receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      prepared: true,
      releaseAuthorized: false,
      candidateIdentity: receipt.candidateIdentity,
      ownerApproval: receipt.ownerApproval.status,
    },
    null,
    2,
  ),
);

async function readJson(file) {
  return readFile(path.join(root, file), "utf8")
    .then((content) => JSON.parse(content))
    .catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
}
