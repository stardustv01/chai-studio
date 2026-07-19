import path from "node:path";
import {
  securityPolicySchemaVersion,
  type ApprovedNetworkResource,
  type ExecutableSecurityPolicy,
  type ExecutableTrustClass,
  type SecurityRootPolicy,
  type TrustClassificationRecord,
  type TrustPromotionReview,
  type WorkerResourceLimits,
} from "./contracts.js";
import { securityIdentity } from "./identity.js";

export const defaultWorkerResourceLimits: WorkerResourceLimits = Object.freeze({
  cpuSeconds: 300,
  memoryMiB: 2_048,
  wallTimeMs: 600_000,
  processCount: 1,
  outputBytes: 20 * 1024 * 1024 * 1024,
  logBytes: 4 * 1024 * 1024,
});

export const studioContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

export const createExecutableSecurityPolicy = (input: {
  readonly projectId: string;
  readonly trustClass: ExecutableTrustClass;
  readonly importedExecutionEnabled: boolean;
  readonly rootPolicies: readonly SecurityRootPolicy[];
  readonly approvedNetworkResources?: readonly ApprovedNetworkResource[];
  readonly environmentAllowlist?: readonly string[];
  readonly limits?: WorkerResourceLimits;
}): ExecutableSecurityPolicy => {
  assertId(input.projectId, "project");
  if (input.trustClass === "imported_untrusted" && !input.importedExecutionEnabled) {
    throw new Error("Imported executable content is disabled until current containment evidence passes.");
  }
  const roots = input.rootPolicies
    .map((root) => ({ ...root, path: path.resolve(root.path) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (roots.length === 0) throw new Error("Security policy requires at least one approved root.");
  const rootIds = new Set<string>();
  for (const root of roots) {
    assertId(root.id, "security root");
    if (rootIds.has(root.id)) throw new Error(`Duplicate security root id ${root.id}.`);
    rootIds.add(root.id);
    if (!path.isAbsolute(root.path)) throw new Error(`Security root ${root.id} is not absolute.`);
  }
  const approvedNetworkResources = normalizeNetworkResources(
    input.trustClass === "imported_untrusted" ? [] : (input.approvedNetworkResources ?? []),
  );
  const environmentAllowlist = [...new Set(input.environmentAllowlist ?? [])].sort();
  for (const key of environmentAllowlist) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) throw new Error(`Environment key ${key} is invalid.`);
  }
  const limits = input.limits ?? defaultWorkerResourceLimits;
  assertLimits(limits);
  const withoutIdentity = {
    schemaVersion: securityPolicySchemaVersion,
    policyVersion: "chai-security-policy-v1" as const,
    projectId: input.projectId,
    trustClass: input.trustClass,
    importedExecutionEnabled: input.importedExecutionEnabled,
    rootPolicies: roots,
    rootFingerprints: roots.map((root) =>
      securityIdentity({ id: root.id, path: root.path, mode: root.mode }),
    ),
    networkMode: approvedNetworkResources.length === 0 ? ("deny" as const) : ("approved-hash-only" as const),
    approvedNetworkResources,
    environmentAllowlist,
    locale: "C.UTF-8" as const,
    timezone: "UTC" as const,
    browser: {
      navigation: "same-origin-only" as const,
      popups: "deny" as const,
      downloads: "deny" as const,
      externalProtocols: "deny" as const,
      fileUrls: "approved-root-only" as const,
      localServices: "studio-origin-only" as const,
      clipboard: "explicit-user-gesture-only" as const,
      permissions: "deny" as const,
      contentSecurityPolicy: studioContentSecurityPolicy,
    },
    limits,
  };
  return { ...withoutIdentity, policyIdentity: securityIdentity(withoutIdentity) };
};

export const createTrustClassification = (input: {
  readonly compositionId: string;
  readonly sourceHash: string;
  readonly trustClass: ExecutableTrustClass;
  readonly classifiedBy: string;
  readonly classifiedAt: Date;
}): TrustClassificationRecord => {
  assertId(input.compositionId, "composition");
  assertId(input.classifiedBy, "actor");
  assertSha256(input.sourceHash, "source");
  const record = {
    schemaVersion: securityPolicySchemaVersion,
    compositionId: input.compositionId,
    sourceHash: input.sourceHash,
    trustClass: input.trustClass,
    classifiedBy: input.classifiedBy,
    classifiedAt: input.classifiedAt.toISOString(),
    promotionReviewId: null,
  };
  return { ...record, identityHash: securityIdentity(record) };
};

export const promoteTrustClassification = (
  current: TrustClassificationRecord,
  review: TrustPromotionReview,
): TrustClassificationRecord => {
  if (current.trustClass !== "imported_untrusted") throw new Error("Only imported content can be promoted.");
  if (review.decision !== "approved") throw new Error("Trust promotion requires an approved review.");
  if (review.compositionId !== current.compositionId || review.sourceHash !== current.sourceHash) {
    throw new Error("Trust review does not match the exact composition source identity.");
  }
  if (review.checklist.length < 4 || review.checklist.some((item) => item.trim().length === 0)) {
    throw new Error("Trust promotion review checklist is incomplete.");
  }
  assertId(review.id, "promotion review");
  assertId(review.reviewerId, "reviewer");
  if (!Number.isFinite(Date.parse(review.reviewedAt))) throw new Error("Trust review timestamp is invalid.");
  const record = {
    schemaVersion: securityPolicySchemaVersion,
    compositionId: current.compositionId,
    sourceHash: current.sourceHash,
    trustClass: "trusted_authored" as const,
    classifiedBy: review.reviewerId,
    classifiedAt: review.reviewedAt,
    promotionReviewId: review.id,
  };
  return { ...record, identityHash: securityIdentity(record) };
};

const normalizeNetworkResources = (
  resources: readonly ApprovedNetworkResource[],
): readonly ApprovedNetworkResource[] =>
  resources
    .map((resource) => {
      const url = new URL(resource.url);
      if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") {
        throw new Error(`Approved network URL is not immutable-safe: ${resource.url}.`);
      }
      assertSha256(resource.contentHash, resource.url);
      return { url: url.href, contentHash: resource.contentHash };
    })
    .sort((left, right) => left.url.localeCompare(right.url));

const assertLimits = (limits: WorkerResourceLimits): void => {
  const fields = Object.entries(limits);
  if (fields.some(([, value]) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("Worker resource limits must be positive safe integers.");
  }
  if (limits.processCount !== 1) throw new Error("Imported worker process count must remain one.");
};

const assertId = (value: string, label: string): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) throw new Error(`${label} id is invalid.`);
};

const assertSha256 = (value: string, label: string): void => {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} requires a SHA-256 identity.`);
};
