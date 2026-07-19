export const securityPolicySchemaVersion = "1.0.0" as const;

export type ExecutableTrustClass = "trusted_authored" | "imported_untrusted";
export type SecurityPathAccess = "read" | "write" | "temporary" | "output";
export type SecurityRootMode = "read-only" | "read-write" | "temporary" | "output-only";

export interface SecurityRootPolicy {
  readonly id: string;
  readonly path: string;
  readonly mode: SecurityRootMode;
}

export interface ApprovedNetworkResource {
  readonly url: string;
  readonly contentHash: string;
}

export interface WorkerResourceLimits {
  readonly cpuSeconds: number;
  readonly memoryMiB: number;
  readonly wallTimeMs: number;
  readonly processCount: number;
  readonly outputBytes: number;
  readonly logBytes: number;
}

export interface BrowserContainmentPolicy {
  readonly navigation: "same-origin-only";
  readonly popups: "deny";
  readonly downloads: "deny";
  readonly externalProtocols: "deny";
  readonly fileUrls: "approved-root-only";
  readonly localServices: "studio-origin-only";
  readonly clipboard: "explicit-user-gesture-only";
  readonly permissions: "deny";
  readonly contentSecurityPolicy: string;
}

export interface ExecutableSecurityPolicy {
  readonly schemaVersion: typeof securityPolicySchemaVersion;
  readonly policyVersion: "chai-security-policy-v1";
  readonly projectId: string;
  readonly trustClass: ExecutableTrustClass;
  readonly importedExecutionEnabled: boolean;
  readonly rootPolicies: readonly SecurityRootPolicy[];
  readonly rootFingerprints: readonly string[];
  readonly networkMode: "deny" | "approved-hash-only";
  readonly approvedNetworkResources: readonly ApprovedNetworkResource[];
  readonly environmentAllowlist: readonly string[];
  readonly locale: "C.UTF-8";
  readonly timezone: "UTC";
  readonly browser: BrowserContainmentPolicy;
  readonly limits: WorkerResourceLimits;
  readonly policyIdentity: string;
}

export interface TrustClassificationRecord {
  readonly schemaVersion: typeof securityPolicySchemaVersion;
  readonly compositionId: string;
  readonly sourceHash: string;
  readonly trustClass: ExecutableTrustClass;
  readonly classifiedBy: string;
  readonly classifiedAt: string;
  readonly promotionReviewId: string | null;
  readonly identityHash: string;
}

export interface TrustPromotionReview {
  readonly schemaVersion: typeof securityPolicySchemaVersion;
  readonly id: string;
  readonly compositionId: string;
  readonly sourceHash: string;
  readonly reviewerId: string;
  readonly decision: "approved" | "rejected";
  readonly checklist: readonly string[];
  readonly reviewedAt: string;
}

export interface WorkerArtifactProvenance {
  readonly schemaVersion: typeof securityPolicySchemaVersion;
  readonly artifactHash: string;
  readonly trustClass: ExecutableTrustClass;
  readonly policyIdentity: string;
  readonly workerPoolId: string;
  readonly browserProfileId: string;
  readonly temporaryRootId: string;
  readonly cacheNamespace: string;
  readonly environmentIdentity: string;
}
