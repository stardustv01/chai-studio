import { createHash } from "node:crypto";
import type { AssetRecord, AssetsDocument } from "@chai-studio/schema";
import { normalizeAssetRegistryPath } from "./asset-registry.js";

export interface AssetRightsProof {
  readonly registryPath: string;
  readonly contentHash: string;
}

export interface AssetRightsRecord {
  readonly assetId: string;
  readonly classification: AssetRecord["rights"];
  readonly creator: string | null;
  readonly sourceUrl: string | null;
  readonly licenseName: string | null;
  readonly licenseUrl: string | null;
  readonly attribution: string | null;
  readonly permittedTerritories: readonly string[];
  readonly prohibitedUses: readonly string[];
  readonly restrictions: readonly string[];
  readonly proofs: readonly AssetRightsProof[];
  readonly expiresAt: string | null;
  readonly reviewedAt: string;
  readonly reviewedBy: string;
}

export interface AssetRightsManifestV1 {
  readonly schemaVersion: "1.0.0";
  readonly projectId: string;
  readonly revisionId: string;
  readonly records: readonly AssetRightsRecord[];
}

export interface DeliveryRightsPolicy {
  readonly missingDetails: "warn" | "block";
  readonly unknownClassification: "warn" | "block";
  readonly requireProofFor: readonly AssetRecord["rights"][];
  readonly territory: string;
  readonly useTags: readonly string[];
  readonly attributionByAssetId: Readonly<Record<string, string>>;
  readonly asOf: string;
}

export interface DeliveryRightsIssue {
  readonly code:
    | "rights.record-missing"
    | "rights.classification-mismatch"
    | "rights.classification-unknown"
    | "rights.proof-missing"
    | "rights.license-details-missing"
    | "rights.expired"
    | "rights.territory-blocked"
    | "rights.use-prohibited"
    | "rights.attribution-missing";
  readonly severity: "warning" | "blocker";
  readonly assetId: string;
  readonly message: string;
  readonly repairHint: string;
}

export interface DeliveryRightsPreflightReport {
  readonly passed: boolean;
  readonly evaluatedAt: string;
  readonly assetIds: readonly string[];
  readonly issues: readonly DeliveryRightsIssue[];
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly manifestFingerprint: string;
}

export const createAssetRightsManifest = (input: {
  readonly projectId: string;
  readonly revisionId: string;
  readonly records: readonly AssetRightsRecord[];
  readonly assets?: AssetsDocument;
}): AssetRightsManifestV1 => {
  if (input.assets !== undefined && input.assets.projectId !== input.projectId) {
    throw new Error("Asset rights manifest project identity does not match assets.json.");
  }
  const assetsById = new Map(input.assets?.assets.map((asset) => [asset.id, asset]));
  const records = [...input.records]
    .map(normalizeRightsRecord)
    .sort((left, right) => left.assetId.localeCompare(right.assetId, "en"));
  const ids = new Set<string>();
  for (const record of records) {
    assertRightsRecord(record);
    if (ids.has(record.assetId)) throw new Error(`Duplicate asset rights record: ${record.assetId}.`);
    if (input.assets !== undefined && !assetsById.has(record.assetId)) {
      throw new Error(`Asset rights reference unknown asset: ${record.assetId}.`);
    }
    ids.add(record.assetId);
  }
  return {
    schemaVersion: "1.0.0",
    projectId: input.projectId,
    revisionId: input.revisionId,
    records,
  };
};

export const serializeAssetRightsManifest = (manifest: AssetRightsManifestV1): string =>
  `${JSON.stringify(createAssetRightsManifest(manifest), null, 2)}\n`;

export const fingerprintAssetRightsManifest = (manifest: AssetRightsManifestV1): string =>
  createHash("sha256").update(serializeAssetRightsManifest(manifest)).digest("hex");

export const assetRightsManifestToAssetRecord = (
  manifest: AssetRightsManifestV1,
  id: string,
  registryPath = "assets/metadata/asset-rights.json",
): AssetRecord => ({
  id,
  path: normalizeAssetRegistryPath(registryPath),
  contentHash: fingerprintAssetRightsManifest(manifest),
  kind: "data",
  durationFrames: null,
  fps: null,
  hasAudio: false,
  hasAlpha: false,
  variableFrameRate: false,
  rights: "owned",
  validationState: "valid",
});

export const preflightDeliveryRights = (input: {
  readonly assets: AssetsDocument;
  readonly manifest: AssetRightsManifestV1;
  readonly deliveryAssetIds: readonly string[];
  readonly policy: DeliveryRightsPolicy;
}): DeliveryRightsPreflightReport => {
  if (Number.isNaN(Date.parse(input.policy.asOf))) {
    throw new Error("Rights preflight requires a valid deterministic evaluation date.");
  }
  const manifest = createAssetRightsManifest({ ...input.manifest, assets: input.assets });
  const recordsById = new Map(manifest.records.map((record) => [record.assetId, record]));
  const assetsById = new Map(input.assets.assets.map((asset) => [asset.id, asset]));
  const assetIds = [...new Set(input.deliveryAssetIds)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const issues: DeliveryRightsIssue[] = [];
  for (const assetId of assetIds) {
    const asset = assetsById.get(assetId);
    if (asset === undefined) throw new Error(`Rights preflight references unknown asset: ${assetId}.`);
    const record = recordsById.get(assetId);
    if (record === undefined) {
      issues.push(
        issue(
          "rights.record-missing",
          policySeverity(input.policy.missingDetails),
          assetId,
          "Detailed rights metadata is missing.",
          "Add a reviewed rights record with source, license, proof, territory, and restrictions.",
        ),
      );
      continue;
    }
    if (record.classification !== asset.rights) {
      issues.push(
        issue(
          "rights.classification-mismatch",
          "blocker",
          assetId,
          `assets.json says ${asset.rights}, but the rights manifest says ${record.classification}.`,
          "Reconcile the authoritative classification before delivery.",
        ),
      );
    }
    if (record.classification === "unknown") {
      issues.push(
        issue(
          "rights.classification-unknown",
          policySeverity(input.policy.unknownClassification),
          assetId,
          "Rights classification remains unknown.",
          "Research ownership or replace the source with a cleared asset.",
        ),
      );
    }
    if (input.policy.requireProofFor.includes(record.classification) && record.proofs.length === 0) {
      issues.push(
        issue(
          "rights.proof-missing",
          "blocker",
          assetId,
          "Required rights proof is missing.",
          "Attach a hashed invoice, license, release, or public-domain evidence file.",
        ),
      );
    }
    if (
      record.classification === "licensed" &&
      (record.licenseName === null || (record.licenseUrl === null && record.sourceUrl === null))
    ) {
      issues.push(
        issue(
          "rights.license-details-missing",
          "blocker",
          assetId,
          "Licensed media lacks a license name or verifiable license/source URL.",
          "Record the exact license and its source before delivery.",
        ),
      );
    }
    if (record.expiresAt !== null && Date.parse(record.expiresAt) < Date.parse(input.policy.asOf)) {
      issues.push(
        issue(
          "rights.expired",
          "blocker",
          assetId,
          `Rights expired at ${record.expiresAt}.`,
          "Renew the license or replace the asset.",
        ),
      );
    }
    if (
      record.permittedTerritories.length > 0 &&
      !record.permittedTerritories.includes("worldwide") &&
      !record.permittedTerritories.includes(input.policy.territory)
    ) {
      issues.push(
        issue(
          "rights.territory-blocked",
          "blocker",
          assetId,
          `Delivery territory ${input.policy.territory} is not permitted.`,
          "Change the delivery territory, obtain broader rights, or replace the asset.",
        ),
      );
    }
    const prohibited = input.policy.useTags.filter((tag) => record.prohibitedUses.includes(tag));
    if (prohibited.length > 0) {
      issues.push(
        issue(
          "rights.use-prohibited",
          "blocker",
          assetId,
          `Delivery use is prohibited for: ${prohibited.join(", ")}.`,
          "Remove the prohibited use, obtain permission, or replace the asset.",
        ),
      );
    }
    if (
      record.attribution !== null &&
      input.policy.attributionByAssetId[assetId]?.trim() !== record.attribution
    ) {
      issues.push(
        issue(
          "rights.attribution-missing",
          "blocker",
          assetId,
          "Required attribution is absent or does not match the reviewed credit line.",
          `Include this exact credit: ${record.attribution}`,
        ),
      );
    }
  }
  issues.sort((left, right) =>
    `${left.assetId}\u0000${left.code}`.localeCompare(`${right.assetId}\u0000${right.code}`, "en"),
  );
  const blockerCount = issues.filter((entry) => entry.severity === "blocker").length;
  return {
    passed: blockerCount === 0,
    evaluatedAt: input.policy.asOf,
    assetIds,
    issues,
    blockerCount,
    warningCount: issues.length - blockerCount,
    manifestFingerprint: fingerprintAssetRightsManifest(manifest),
  };
};

const normalizeRightsRecord = (record: AssetRightsRecord): AssetRightsRecord => ({
  ...record,
  creator: normalizeOptionalText(record.creator),
  sourceUrl: normalizeOptionalText(record.sourceUrl),
  licenseName: normalizeOptionalText(record.licenseName),
  licenseUrl: normalizeOptionalText(record.licenseUrl),
  attribution: normalizeOptionalText(record.attribution),
  permittedTerritories: sortedUnique(record.permittedTerritories),
  prohibitedUses: sortedUnique(record.prohibitedUses),
  restrictions: sortedUnique(record.restrictions),
  proofs: [...record.proofs]
    .map((proof) => ({ ...proof, registryPath: normalizeAssetRegistryPath(proof.registryPath) }))
    .sort((left, right) => left.registryPath.localeCompare(right.registryPath, "en")),
});

const assertRightsRecord = (record: AssetRightsRecord): void => {
  if (
    !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(record.assetId) ||
    record.reviewedBy.trim().length === 0 ||
    Number.isNaN(Date.parse(record.reviewedAt)) ||
    (record.expiresAt !== null && Number.isNaN(Date.parse(record.expiresAt))) ||
    record.proofs.some((proof) => !/^[a-f0-9]{64}$/.test(proof.contentHash))
  ) {
    throw new Error(`Invalid asset rights record: ${record.assetId}.`);
  }
  for (const url of [record.sourceUrl, record.licenseUrl]) {
    if (url !== null && !isHttpUrl(url)) throw new Error(`Invalid rights URL for ${record.assetId}.`);
  }
};

const normalizeOptionalText = (value: string | null): string | null => {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
};

const sortedUnique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const policySeverity = (value: "warn" | "block"): DeliveryRightsIssue["severity"] =>
  value === "block" ? "blocker" : "warning";

const issue = (
  code: DeliveryRightsIssue["code"],
  severity: DeliveryRightsIssue["severity"],
  assetId: string,
  message: string,
  repairHint: string,
): DeliveryRightsIssue => ({ code, severity, assetId, message, repairHint });
