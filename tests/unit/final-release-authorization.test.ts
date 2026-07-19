import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  approvalIdentity,
  assertOwnerApproval,
  unsignedReceiptBytes,
  verifySignedReleaseReceipt,
} from "../../scripts/release-approval.mjs";

const approval = {
  schemaVersion: "1.0.0",
  product: "Chai Studio",
  version: "1.0.0",
  approved: true,
  inferred: false,
  owner: "Release owner",
  approvedAt: "2026-07-16T00:00:00.000Z",
  statement: "I explicitly approve and authorize the Version 1 release of Chai Studio.",
} as const;

describe("P28 explicit release authorization", () => {
  it("rejects missing, inferred, ambiguous, and malformed approval", () => {
    expect(() => assertOwnerApproval(null)).toThrow(/explicit/iu);
    expect(() => assertOwnerApproval({ ...approval, inferred: true })).toThrow(/explicit/iu);
    expect(() => assertOwnerApproval({ ...approval, statement: "Continue automatically." })).toThrow(
      /explicit/iu,
    );
    expect(() =>
      assertOwnerApproval({
        ...approval,
        statement: "I do not authorize the Version 1 release of Chai Studio.",
      }),
    ).toThrow(/explicit/iu);
    expect(() => assertOwnerApproval({ ...approval, approvedAt: "not-a-date" })).toThrow(/explicit/iu);
  });

  it("accepts only the exact explicit owner approval contract", () => {
    const reorderedApproval = {
      statement: approval.statement,
      approvedAt: approval.approvedAt,
      owner: approval.owner,
      inferred: approval.inferred,
      approved: approval.approved,
      version: approval.version,
      product: approval.product,
      schemaVersion: approval.schemaVersion,
    } as const;
    expect(assertOwnerApproval(approval)).toEqual(approval);
    expect(approvalIdentity(approval)).toMatch(/^[a-f0-9]{64}$/u);
    expect(approvalIdentity(reorderedApproval)).toBe(approvalIdentity(approval));
  });

  it("verifies the exact authorized receipt and rejects post-signature mutation", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const payload = {
      version: "1.0.0",
      ownerApproval: { status: "explicitly-approved", inferred: false },
      signature: null,
      releaseAuthorized: true,
      releaseTagAuthorized: true,
    };
    const signature = sign(null, unsignedReceiptBytes(payload), privateKey).toString("base64");
    const receipt = { ...payload, signature: { algorithm: "Ed25519", value: signature } };
    expect(verifySignedReleaseReceipt(receipt, publicKey)).toBe(true);
    expect(verifySignedReleaseReceipt({ ...receipt, version: "1.0.1" }, publicKey)).toBe(false);
  });
});
