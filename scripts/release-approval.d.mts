import type { KeyObject } from "node:crypto";

export interface OwnerApprovalV1 {
  readonly schemaVersion: "1.0.0";
  readonly product: "Chai Studio";
  readonly version: "1.0.0" | `1.0.0-rc.${number}`;
  readonly distribution: "public";
  readonly approved: true;
  readonly inferred: false;
  readonly owner: string;
  readonly approvedAt: string;
  readonly statement: string;
}

export interface PublicDistributionReview {
  readonly schemaVersion: "1.0.0";
  readonly product: "Chai Studio";
  readonly version: "1.0.0" | `1.0.0-rc.${number}`;
  readonly trigger: "public-distribution";
  readonly decision: "approved-public-distribution";
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly inventoryIdentity: string;
  readonly noticesAndObligations: readonly string[];
  readonly reReviewCondition: string;
}

export const approvalStatementFor: (version: string, distribution: "public") => string;
export const assertOwnerApproval: (approval: unknown) => OwnerApprovalV1;
export const assertPublicDistributionReview: (
  review: unknown,
  expected: { readonly version: string; readonly inventoryIdentity: string },
) => PublicDistributionReview;
export const approvalIdentity: (approval: unknown) => string;
export const publicDistributionReviewIdentity: (
  review: unknown,
  expected: { readonly version: string; readonly inventoryIdentity: string },
) => string;
export const manifestDocumentIdentity: (
  manifest: Readonly<Record<string, unknown>>,
  identityField?: string,
) => string;
export const verifyManifestDocumentIdentity: (
  manifest: Readonly<Record<string, unknown>>,
  identityField?: string,
) => boolean;
export const acceptanceGateReportIdentity: (report: Readonly<Record<string, unknown>>) => string;
export const verifyAcceptanceGateReportIdentity: (report: Readonly<Record<string, unknown>>) => boolean;
export const unsignedReceiptBytes: (receipt: Readonly<Record<string, unknown>>) => Buffer;
export const verifySignedReleaseReceipt: (
  receipt: Readonly<Record<string, unknown>>,
  publicKeyPem: string | Buffer | KeyObject,
) => boolean;
