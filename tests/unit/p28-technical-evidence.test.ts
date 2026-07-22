import { describe, expect, it } from "vitest";

import {
  assessAuthorizationLifecycle,
  traceabilityMatchesLifecycle,
} from "../../scripts/p28-technical-evidence.mjs";

const target = { version: "1.0.0-rc.4", distribution: "public" } as const;

const receipt = (overrides: Record<string, unknown> = {}) => ({
  version: target.version,
  candidate: target.version,
  distribution: target.distribution,
  ownerApproval: { status: "pending-explicit-owner-approval", inferred: false },
  publicDistributionReview: { status: "pending-public-distribution-review" },
  releaseAuthorized: false,
  releaseTagAuthorized: false,
  signature: null,
  ...overrides,
});

const traceability = (passed: number, pendingStatus = "pending-owner-approval") => ({
  rows: Array.from({ length: 20 }, (_, index) => ({
    status: index < passed ? "passed" : index === passed ? pendingStatus : "ready-pending-release",
  })),
  implementedTechnicalCount: passed,
  unexplainedWaivers: 0,
  unresolvedTechnicalBlockers: 0,
});

describe("P28 technical evidence lifecycle", () => {
  it("accepts the honest preapproval state with 18 technical rows", () => {
    const lifecycle = assessAuthorizationLifecycle(receipt(), target);
    expect(lifecycle).toMatchObject({ valid: true, stage: "pending-signature" });
    expect(traceabilityMatchesLifecycle(traceability(18), lifecycle)).toBe(true);
  });

  it("accepts an approved receipt before signing with all rows passed", () => {
    const lifecycle = assessAuthorizationLifecycle(
      receipt({
        ownerApproval: { status: "explicit-approval-validated-pending-signature", inferred: false },
        publicDistributionReview: { status: "approved-public-distribution" },
      }),
      target,
    );
    expect(lifecycle).toMatchObject({ valid: true, stage: "pending-signature" });
    expect(traceabilityMatchesLifecycle(traceability(20), lifecycle)).toBe(true);
  });

  it("accepts owner approval while public distribution review is still pending", () => {
    const lifecycle = assessAuthorizationLifecycle(
      receipt({
        ownerApproval: { status: "explicit-approval-validated-pending-signature", inferred: false },
      }),
      target,
    );
    expect(lifecycle).toMatchObject({
      valid: true,
      stage: "pending-signature",
      approvedLifecycle: false,
    });
    expect(
      traceabilityMatchesLifecycle(traceability(18, "pending-public-distribution-review"), lifecycle),
    ).toBe(true);
  });

  it("accepts finalized evidence for the protected tag workflow", () => {
    const lifecycle = assessAuthorizationLifecycle(
      receipt({
        ownerApproval: { status: "explicitly-approved", inferred: false },
        publicDistributionReview: { status: "approved-public-distribution" },
        releaseAuthorized: true,
        releaseTagAuthorized: true,
        signature: { algorithm: "Ed25519", value: "test" },
      }),
      target,
    );
    expect(lifecycle).toMatchObject({ valid: true, stage: "finalized" });
    expect(traceabilityMatchesLifecycle(traceability(20), lifecycle)).toBe(true);
  });

  it("rejects a finalized receipt without a signature", () => {
    const lifecycle = assessAuthorizationLifecycle(
      receipt({
        ownerApproval: { status: "explicitly-approved", inferred: false },
        publicDistributionReview: { status: "approved-public-distribution" },
        releaseAuthorized: true,
        releaseTagAuthorized: true,
      }),
      target,
    );
    expect(lifecycle).toMatchObject({ valid: false, stage: "invalid" });
  });

  it("rejects an approved lifecycle with only 18 passed rows", () => {
    const lifecycle = assessAuthorizationLifecycle(
      receipt({
        ownerApproval: { status: "explicit-approval-validated-pending-signature", inferred: false },
        publicDistributionReview: { status: "approved-public-distribution" },
      }),
      target,
    );
    expect(traceabilityMatchesLifecycle(traceability(18), lifecycle)).toBe(false);
  });

  it("rejects malformed pending traceability rows", () => {
    const malformed = traceability(18);
    malformed.rows[19] = { status: "pending-owner-approval" };
    expect(traceabilityMatchesLifecycle(malformed, assessAuthorizationLifecycle(receipt(), target))).toBe(
      false,
    );
  });

  it("rejects a pending reason that does not match the receipt lifecycle", () => {
    const lifecycle = assessAuthorizationLifecycle(
      receipt({
        ownerApproval: { status: "explicit-approval-validated-pending-signature", inferred: false },
      }),
      target,
    );
    expect(traceabilityMatchesLifecycle(traceability(18), lifecycle)).toBe(false);
  });
});
