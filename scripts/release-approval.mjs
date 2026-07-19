import { createHash, verify } from "node:crypto";

const exactApprovalStatement = "I explicitly approve and authorize the Version 1 release of Chai Studio.";

export const assertOwnerApproval = (approval) => {
  const approvedAt = typeof approval?.approvedAt === "string" ? approval.approvedAt : "";
  if (
    approval?.schemaVersion !== "1.0.0" ||
    approval?.product !== "Chai Studio" ||
    approval?.version !== "1.0.0" ||
    approval?.approved !== true ||
    approval?.inferred !== false ||
    typeof approval?.owner !== "string" ||
    approval.owner.trim().length === 0 ||
    Number.isNaN(Date.parse(approvedAt)) ||
    new Date(approvedAt).toISOString() !== approvedAt ||
    approval?.statement !== exactApprovalStatement
  ) {
    throw new Error("Explicit Version 1 owner approval evidence is missing or invalid.");
  }
  return approval;
};

export const approvalIdentity = (approval) => {
  assertOwnerApproval(approval);
  return createHash("sha256").update(canonicalJson(approval)).digest("hex");
};

export const unsignedReceiptBytes = (receipt) => Buffer.from(JSON.stringify({ ...receipt, signature: null }));

export const verifySignedReleaseReceipt = (receipt, publicKeyPem) => {
  if (
    receipt?.releaseAuthorized !== true ||
    receipt?.releaseTagAuthorized !== true ||
    receipt?.ownerApproval?.status !== "explicitly-approved" ||
    receipt?.ownerApproval?.inferred !== false ||
    receipt?.signature?.algorithm !== "Ed25519" ||
    typeof receipt?.signature?.value !== "string"
  ) {
    return false;
  }
  return verify(
    null,
    unsignedReceiptBytes(receipt),
    publicKeyPem,
    Buffer.from(receipt.signature.value, "base64"),
  );
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
