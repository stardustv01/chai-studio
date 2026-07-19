import type { KeyObject } from "node:crypto";

export interface OwnerApprovalV1 {
  readonly schemaVersion: "1.0.0";
  readonly product: "Chai Studio";
  readonly version: "1.0.0";
  readonly approved: true;
  readonly inferred: false;
  readonly owner: string;
  readonly approvedAt: string;
  readonly statement: string;
}

export const assertOwnerApproval: (approval: unknown) => OwnerApprovalV1;
export const approvalIdentity: (approval: unknown) => string;
export const unsignedReceiptBytes: (receipt: Readonly<Record<string, unknown>>) => Buffer;
export const verifySignedReleaseReceipt: (
  receipt: Readonly<Record<string, unknown>>,
  publicKeyPem: string | Buffer | KeyObject,
) => boolean;
