export interface P28ReleaseTarget {
  readonly version: string;
  readonly distribution: string;
}

export interface P28AuthorizationLifecycle {
  readonly valid: boolean;
  readonly stage: "pending-signature" | "finalized" | "invalid";
  readonly ownerApprovalRequired: boolean;
  readonly approvedLifecycle: boolean;
  readonly expectedPendingStatus: "pending-owner-approval" | "pending-public-distribution-review" | null;
}

export function assessAuthorizationLifecycle(
  receipt: unknown,
  target: P28ReleaseTarget,
): P28AuthorizationLifecycle;

export function traceabilityMatchesLifecycle(
  traceability: unknown,
  authorization: P28AuthorizationLifecycle,
): boolean;
