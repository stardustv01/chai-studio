import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvalIdentity,
  assertPublicDistributionReview,
  assertOwnerApproval,
  publicDistributionReviewIdentity,
  unsignedReceiptBytes,
  verifyAcceptanceGateReportIdentity,
  verifyManifestDocumentIdentity,
  verifySignedReleaseReceipt,
} from "./release-approval.mjs";
import { resolveReleaseTarget } from "./release-target.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindFinalGate = process.argv.includes("--bind-final-gate");
const approvalPath = path.join(root, "governance/V1_OWNER_APPROVAL.json");
const approval = assertOwnerApproval(JSON.parse(await readFile(approvalPath, "utf8")));
const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const target = resolveReleaseTarget({ packageManifest });
if (approval.version !== target.version || approval.distribution !== target.distribution) {
  throw new Error("Owner approval does not match the exact release target.");
}
const dependencyInventoryBytes = await readFile(
  path.join(root, "governance/licenses/dependency-inventory.json"),
);
const dependencyInventory = JSON.parse(dependencyInventoryBytes.toString("utf8"));
const distributionReviewBytes = await readFile(
  path.join(root, "governance/licenses/public-distribution-review.json"),
);
const distributionReview = assertPublicDistributionReview(
  JSON.parse(distributionReviewBytes.toString("utf8")),
  { version: target.version, inventoryIdentity: dependencyInventory.identityHash },
);
const distributionReviewIdentity = publicDistributionReviewIdentity(distributionReview, {
  version: target.version,
  inventoryIdentity: dependencyInventory.identityHash,
});
const dependencyInventorySha256 = createHash("sha256").update(dependencyInventoryBytes).digest("hex");
const distributionReviewSha256 = createHash("sha256").update(distributionReviewBytes).digest("hex");
const finalManifest = JSON.parse(
  await readFile(path.join(root, "evidence/p28/version-1-manifest.json"), "utf8"),
);
const traceability = JSON.parse(
  await readFile(path.join(root, "evidence/p28/traceability-matrix.json"), "utf8"),
);
if (
  finalManifest.version !== target.version ||
  finalManifest.releaseTag !== target.releaseTag ||
  finalManifest.distribution !== target.distribution ||
  finalManifest.releaseAuthorized !== false ||
  !verifyManifestDocumentIdentity(finalManifest) ||
  finalManifest.dependencyInventoryIdentity !== dependencyInventory.identityHash ||
  finalManifest.dependencyInventorySha256 !== dependencyInventorySha256 ||
  finalManifest.publicDistributionReviewIdentity !== distributionReviewIdentity ||
  finalManifest.publicDistributionReviewSha256 !== distributionReviewSha256 ||
  traceability.rows?.length !== 20 ||
  !traceability.rows.every((row) => row.status === "passed")
) {
  throw new Error("Final release source, manifest, or traceability is not ready for signing.");
}
const expectedApprovalIdentity = approvalIdentity(approval);
const candidatePath = path.join(root, "evidence/p28/version-1-release-receipt.json");
const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
if (
  finalManifest.approvalIdentity !== expectedApprovalIdentity ||
  candidate.ownerApproval?.approvalSha256 !== expectedApprovalIdentity ||
  traceability.identity !== candidate.traceabilityIdentity ||
  finalManifest.manifestIdentity !== candidate.finalManifestIdentity ||
  candidate.dependencyInventoryIdentity !== dependencyInventory.identityHash ||
  candidate.dependencyInventorySha256 !== dependencyInventorySha256 ||
  candidate.publicDistributionReviewIdentity !== distributionReviewIdentity ||
  candidate.publicDistributionReviewSha256 !== distributionReviewSha256 ||
  candidate.publicDistributionReview?.inventoryIdentity !== dependencyInventory.identityHash ||
  candidate.publicDistributionReview?.reviewIdentity !== distributionReviewIdentity
) {
  throw new Error("Approval, traceability, manifest, and receipt identities do not agree.");
}
if (
  !bindFinalGate &&
  (candidate.version !== target.version ||
    candidate.candidate !== target.version ||
    candidate.distribution !== target.distribution ||
    candidate.releaseAuthorized !== false ||
    candidate.releaseTagAuthorized !== false ||
    candidate.ownerApproval?.status !== "explicit-approval-validated-pending-signature" ||
    candidate.ownerApproval?.inferred !== false ||
    candidate.publicDistributionReview?.status !== "approved-public-distribution" ||
    candidate.signature !== null ||
    candidate.finalGateIdentity !== null)
) {
  throw new Error("Release receipt is not in the required preapproval state.");
}
const keyDirectory = path.join(os.homedir(), ".config/chai-studio");
const privateKeyPath = path.join(keyDirectory, "release-signing-ed25519.pem");
const privateKey = await readFile(privateKeyPath, "utf8").catch(async () => {
  const generated = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await mkdir(keyDirectory, { recursive: true });
  await writeFile(privateKeyPath, generated.privateKey, { mode: 0o600 });
  await chmod(privateKeyPath, 0o600);
  return generated.privateKey;
});
const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
if (bindFinalGate && !verifySignedReleaseReceipt(candidate, publicKeyPem)) {
  throw new Error("Only an already valid signed release receipt can be bound to the final gate.");
}
const finalGate = bindFinalGate
  ? JSON.parse(await readFile(path.join(root, "evidence/p28/gate-report.json"), "utf8"))
  : null;
if (
  bindFinalGate &&
  (finalGate?.passed !== true || finalGate?.phase !== "P28" || !verifyAcceptanceGateReportIdentity(finalGate))
) {
  throw new Error("A passing P28 final gate report is required before receipt binding.");
}
const approvalSha256 = expectedApprovalIdentity;
const signedPayload = {
  ...candidate,
  ownerApproval: {
    status: "explicitly-approved",
    inferred: false,
    evidence: "governance/V1_OWNER_APPROVAL.json",
    approvalSha256,
  },
  version: target.version,
  candidate: target.version,
  distribution: target.distribution,
  finalGateIdentity: finalGate?.identity ?? null,
  signature: null,
  releaseAuthorized: true,
  releaseTagAuthorized: true,
};
const bytes = unsignedReceiptBytes(signedPayload);
const signature = sign(null, bytes, privateKey).toString("base64");
const receipt = {
  ...signedPayload,
  signature: {
    algorithm: "Ed25519",
    value: signature,
    publicKeySha256: createHash("sha256").update(publicKeyPem).digest("hex"),
    publicKeyFile: "evidence/p28/version-1-release-public-key.pem",
  },
};
if (!verifySignedReleaseReceipt(receipt, publicKeyPem)) {
  throw new Error("Generated release receipt signature did not verify.");
}
await writeFile(candidatePath, `${JSON.stringify(receipt, null, 2)}\n`);
await writeFile(path.join(root, "evidence/p28/version-1-release-public-key.pem"), publicKeyPem);
console.log(
  JSON.stringify(
    {
      signed: true,
      finalGateBound: bindFinalGate,
      releaseAuthorized: true,
      owner: approval.owner,
      privateKeyMode: (await stat(privateKeyPath)).mode & 0o777,
      publicKeySha256: receipt.signature.publicKeySha256,
    },
    null,
    2,
  ),
);
