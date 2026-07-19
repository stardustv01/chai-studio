import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvalIdentity,
  assertOwnerApproval,
  unsignedReceiptBytes,
  verifySignedReleaseReceipt,
} from "./release-approval.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindFinalGate = process.argv.includes("--bind-final-gate");
const approvalPath = path.join(root, "governance/V1_OWNER_APPROVAL.json");
const approval = assertOwnerApproval(JSON.parse(await readFile(approvalPath, "utf8")));
const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const releaseSource = await readFile(path.join(root, "packages/diagnostics/src/release.ts"), "utf8");
const finalManifest = JSON.parse(
  await readFile(path.join(root, "evidence/p28/version-1-manifest.json"), "utf8"),
);
const traceability = JSON.parse(
  await readFile(path.join(root, "evidence/p28/traceability-matrix.json"), "utf8"),
);
if (
  packageManifest.version !== "1.0.0" ||
  !releaseSource.includes('version: "1.0.0"') ||
  finalManifest.version !== "1.0.0" ||
  finalManifest.releaseAuthorized !== false ||
  traceability.rows?.length !== 20 ||
  !traceability.rows.every((row) => row.status === "passed")
) {
  throw new Error("Final Version 1 source, manifest, or traceability is not ready for signing.");
}
const expectedApprovalIdentity = approvalIdentity(approval);
const candidatePath = path.join(root, "evidence/p28/version-1-release-receipt.json");
const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
if (
  finalManifest.approvalIdentity !== expectedApprovalIdentity ||
  candidate.ownerApproval?.approvalSha256 !== expectedApprovalIdentity ||
  traceability.identity !== candidate.traceabilityIdentity ||
  finalManifest.manifestIdentity !== candidate.finalManifestIdentity
) {
  throw new Error("Approval, traceability, manifest, and receipt identities do not agree.");
}
if (
  !bindFinalGate &&
  (candidate.releaseAuthorized !== false ||
    candidate.releaseTagAuthorized !== false ||
    candidate.ownerApproval?.status !== "explicit-approval-validated-pending-signature" ||
    candidate.ownerApproval?.inferred !== false ||
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
if (bindFinalGate && finalGate?.passed !== true) {
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
  throw new Error("Generated Version 1 receipt signature did not verify.");
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
