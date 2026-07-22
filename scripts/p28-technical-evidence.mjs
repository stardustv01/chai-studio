export function assessAuthorizationLifecycle(receipt, target) {
  const ownerApprovalStatus = receipt?.ownerApproval?.status;
  const publicReviewStatus = receipt?.publicDistributionReview?.status;
  const exactTarget =
    receipt?.version === target.version &&
    receipt?.candidate === target.version &&
    receipt?.distribution === target.distribution &&
    receipt?.ownerApproval?.inferred === false;
  const pendingAuthorization =
    exactTarget &&
    receipt?.releaseAuthorized === false &&
    receipt?.releaseTagAuthorized === false &&
    receipt?.signature === null &&
    ["pending-explicit-owner-approval", "explicit-approval-validated-pending-signature"].includes(
      ownerApprovalStatus,
    ) &&
    ["pending-public-distribution-review", "approved-public-distribution"].includes(publicReviewStatus);
  const finalizedAuthorization =
    exactTarget &&
    receipt?.releaseAuthorized === true &&
    receipt?.releaseTagAuthorized === true &&
    ownerApprovalStatus === "explicitly-approved" &&
    publicReviewStatus === "approved-public-distribution" &&
    typeof receipt?.signature === "object" &&
    receipt.signature !== null;

  return {
    valid: pendingAuthorization || finalizedAuthorization,
    stage: finalizedAuthorization ? "finalized" : pendingAuthorization ? "pending-signature" : "invalid",
    ownerApprovalRequired: ownerApprovalStatus === "pending-explicit-owner-approval",
    approvedLifecycle:
      (ownerApprovalStatus === "explicit-approval-validated-pending-signature" ||
        ownerApprovalStatus === "explicitly-approved") &&
      publicReviewStatus === "approved-public-distribution",
    expectedPendingStatus:
      ownerApprovalStatus === "pending-explicit-owner-approval"
        ? "pending-owner-approval"
        : publicReviewStatus === "pending-public-distribution-review"
          ? "pending-public-distribution-review"
          : null,
  };
}

export function traceabilityMatchesLifecycle(traceability, authorization) {
  const approvedLifecycle = authorization?.approvedLifecycle === true;
  const statuses = Array.isArray(traceability?.rows) ? traceability.rows.map((row) => row.status) : [];
  const passedCount = statuses.filter((status) => status === "passed").length;
  const pendingStatuses = statuses.filter((status) =>
    ["pending-owner-approval", "pending-public-distribution-review"].includes(status),
  );
  const readyCount = statuses.filter((status) => status === "ready-pending-release").length;
  return (
    traceability?.rows?.length === 20 &&
    passedCount === (approvedLifecycle ? 20 : 18) &&
    pendingStatuses.length === (approvedLifecycle ? 0 : 1) &&
    (approvedLifecycle || pendingStatuses[0] === authorization?.expectedPendingStatus) &&
    readyCount === (approvedLifecycle ? 0 : 1) &&
    traceability?.implementedTechnicalCount === (approvedLifecycle ? 20 : 18) &&
    traceability?.unexplainedWaivers === 0 &&
    traceability?.unresolvedTechnicalBlockers === 0
  );
}
