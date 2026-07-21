import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approvalIdentity, assertOwnerApproval } from "./release-approval.mjs";

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
const payload = {
  schemaVersion: "1.0.0",
  product: "Chai Studio",
  version: "1.0.0",
  candidate: finalManifest ? "1.0.0" : "1.0.0-rc.4",
  sourceGateIdentity: p27.identity,
  releaseManifestIdentity: p27Manifest.manifestIdentity,
  finalManifestIdentity: finalManifest?.manifestIdentity ?? null,
  traceabilityIdentity: traceability.identity,
  technicalGateIdentity: technicalGate?.identity ?? null,
  technicalGatePassed: technicalGate?.passed === true,
  dependencyLockSha256: finalManifest?.dependencyLockSha256 ?? p27Manifest.dependencyLockSha256,
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
