import { createHash, verify } from "node:crypto";

const releaseVersionPattern = /^1\.0\.0(?:-rc\.\d+)?$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export const approvalStatementFor = (version, distribution) =>
  `I explicitly approve and authorize Chai Studio ${version} for ${distribution} release.`;

export const assertOwnerApproval = (approval) => {
  const approvedAt = typeof approval?.approvedAt === "string" ? approval.approvedAt : "";
  if (
    approval?.schemaVersion !== "1.0.0" ||
    approval?.product !== "Chai Studio" ||
    !releaseVersionPattern.test(approval?.version ?? "") ||
    approval?.distribution !== "public" ||
    approval?.approved !== true ||
    approval?.inferred !== false ||
    typeof approval?.owner !== "string" ||
    approval.owner.trim().length === 0 ||
    Number.isNaN(Date.parse(approvedAt)) ||
    new Date(approvedAt).toISOString() !== approvedAt ||
    approval?.statement !== approvalStatementFor(approval.version, approval.distribution)
  ) {
    throw new Error("Explicit release owner approval evidence is missing or invalid.");
  }
  return approval;
};

export const approvalIdentity = (approval) => {
  assertOwnerApproval(approval);
  return createHash("sha256").update(canonicalJson(approval)).digest("hex");
};

export const publicDistributionReviewIdentity = (review, expected) => {
  assertPublicDistributionReview(review, expected);
  return createHash("sha256").update(canonicalJson(review)).digest("hex");
};

export const manifestDocumentIdentity = (manifest, identityField = "manifestIdentity") => {
  const payload = Object.fromEntries(Object.entries(manifest ?? {}).filter(([key]) => key !== identityField));
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
};

export const verifyManifestDocumentIdentity = (manifest, identityField = "manifestIdentity") =>
  sha256Pattern.test(manifest?.[identityField] ?? "") &&
  manifestDocumentIdentity(manifest, identityField) === manifest[identityField];

export const acceptanceGateReportIdentity = (report) => {
  const checks = Array.isArray(report?.results)
    ? report.results.map(({ name, passed, exitCode }) => ({ name, passed, exitCode }))
    : null;
  if (
    typeof report?.phase !== "string" ||
    typeof report?.taskRange !== "string" ||
    typeof report?.passed !== "boolean" ||
    typeof report?.environment?.platform !== "string" ||
    typeof report?.environment?.architecture !== "string" ||
    typeof report?.environment?.node !== "string" ||
    typeof report?.environment?.lockfileSha256 !== "string" ||
    typeof report?.environment?.browserExecutable !== "string" ||
    typeof report?.environment?.browserIdentity !== "string" ||
    typeof report?.environment?.engineExecutable !== "string" ||
    typeof report?.environment?.engineIdentity !== "string" ||
    report?.implementationFiles === null ||
    typeof report?.implementationFiles !== "object" ||
    checks === null ||
    checks.length === 0 ||
    checks.some(
      (check) =>
        typeof check.name !== "string" ||
        typeof check.passed !== "boolean" ||
        !Number.isSafeInteger(check.exitCode),
    )
  ) {
    throw new Error("Acceptance gate report identity input is malformed.");
  }
  const identityInput = {
    phase: report.phase,
    taskRange: report.taskRange,
    passed: report.passed,
    platform: `${report.environment.platform}-${report.environment.architecture}`,
    node: report.environment.node,
    lockfileSha256: report.environment.lockfileSha256,
    browserExecutable: report.environment.browserExecutable,
    browserIdentity: report.environment.browserIdentity,
    engineExecutable: report.environment.engineExecutable,
    engineIdentity: report.environment.engineIdentity,
    implementationFiles: report.implementationFiles,
    checks,
  };
  return createHash("sha256").update(JSON.stringify(identityInput)).digest("hex");
};

export const verifyAcceptanceGateReportIdentity = (report) => {
  try {
    const checks = Array.isArray(report?.results) ? report.results : [];
    const allChecksPassed =
      checks.length > 0 && checks.every((check) => check?.passed === true && check?.exitCode === 0);
    return (
      report?.passed === allChecksPassed &&
      allChecksPassed &&
      sha256Pattern.test(report?.identity ?? "") &&
      acceptanceGateReportIdentity(report) === report.identity
    );
  } catch {
    return false;
  }
};

export const unsignedReceiptBytes = (receipt) => Buffer.from(JSON.stringify({ ...receipt, signature: null }));

export const verifySignedReleaseReceipt = (receipt, publicKeyPem) => {
  if (
    !releaseVersionPattern.test(receipt?.version ?? "") ||
    receipt?.candidate !== receipt.version ||
    receipt?.distribution !== "public" ||
    receipt?.releaseAuthorized !== true ||
    receipt?.releaseTagAuthorized !== true ||
    receipt?.ownerApproval?.status !== "explicitly-approved" ||
    receipt?.ownerApproval?.inferred !== false ||
    receipt?.publicDistributionReview?.status !== "approved-public-distribution" ||
    !sha256Pattern.test(receipt?.dependencyInventoryIdentity ?? "") ||
    !sha256Pattern.test(receipt?.dependencyInventorySha256 ?? "") ||
    !sha256Pattern.test(receipt?.publicDistributionReviewIdentity ?? "") ||
    !sha256Pattern.test(receipt?.publicDistributionReviewSha256 ?? "") ||
    receipt?.publicDistributionReview?.inventoryIdentity !== receipt.dependencyInventoryIdentity ||
    receipt?.publicDistributionReview?.reviewIdentity !== receipt.publicDistributionReviewIdentity ||
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

export const assertPublicDistributionReview = (review, { version, inventoryIdentity }) => {
  const reviewedAt = typeof review?.reviewedAt === "string" ? review.reviewedAt : "";
  if (
    !releaseVersionPattern.test(version ?? "") ||
    !sha256Pattern.test(inventoryIdentity ?? "") ||
    review?.schemaVersion !== "1.0.0" ||
    review?.product !== "Chai Studio" ||
    review?.version !== version ||
    review?.trigger !== "public-distribution" ||
    review?.decision !== "approved-public-distribution" ||
    review?.inventoryIdentity !== inventoryIdentity ||
    !sha256Pattern.test(review.inventoryIdentity) ||
    typeof review?.reviewer !== "string" ||
    review.reviewer.trim().length === 0 ||
    Number.isNaN(Date.parse(reviewedAt)) ||
    new Date(reviewedAt).toISOString() !== reviewedAt ||
    !Array.isArray(review?.noticesAndObligations) ||
    review.noticesAndObligations.length === 0 ||
    !review.noticesAndObligations.every((entry) => typeof entry === "string" && entry.trim().length > 0) ||
    typeof review?.reReviewCondition !== "string" ||
    review.reReviewCondition.trim().length === 0
  ) {
    throw new Error("Explicit public-distribution review evidence is missing or invalid.");
  }
  return review;
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
