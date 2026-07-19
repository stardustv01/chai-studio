import { createHash } from "node:crypto";
import type { AssetRecord, AssetsDocument } from "@chai-studio/schema";
import type { AssetDuplicateGroup } from "./asset-change-detection.js";

export interface AssetCurationRecord {
  readonly assetId: string;
  readonly favorite: boolean;
  readonly decision: "unreviewed" | "approved" | "rejected";
  readonly note: string | null;
  readonly updatedAt: string;
  readonly actorId: string;
}

export interface AssetCurationManifestV1 {
  readonly schemaVersion: "1.0.0";
  readonly projectId: string;
  readonly revisionId: string;
  readonly records: readonly AssetCurationRecord[];
}

export interface AssetCurationMutationV1 {
  readonly schemaVersion: "1.0.0";
  readonly assetId: string;
  readonly fromRevisionId: string;
  readonly toRevisionId: string;
  readonly before: AssetCurationRecord | null;
  readonly after: AssetCurationRecord | null;
}

export interface AssetCurationMutationResult {
  readonly manifest: AssetCurationManifestV1;
  readonly mutation: AssetCurationMutationV1;
  readonly inverse: AssetCurationMutationV1;
}

export interface DuplicateReviewGroup {
  readonly contentHash: string;
  readonly assetIds: readonly string[];
  readonly approvedAssetIds: readonly string[];
  readonly rejectedAssetIds: readonly string[];
  readonly favoriteAssetIds: readonly string[];
  readonly pendingAssetIds: readonly string[];
  readonly reviewState: "unreviewed" | "in-progress" | "resolved";
}

export const createAssetCurationManifest = (input: {
  readonly projectId: string;
  readonly revisionId: string;
  readonly records: readonly AssetCurationRecord[];
  readonly knownAssetIds?: ReadonlySet<string>;
}): AssetCurationManifestV1 => {
  const records = [...input.records].sort((left, right) => left.assetId.localeCompare(right.assetId, "en"));
  const ids = new Set<string>();
  for (const record of records) {
    assertRecord(record);
    if (ids.has(record.assetId)) throw new Error(`Duplicate asset curation record: ${record.assetId}.`);
    if (input.knownAssetIds !== undefined && !input.knownAssetIds.has(record.assetId)) {
      throw new Error(`Asset curation references unknown asset: ${record.assetId}.`);
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

export const updateAssetCuration = (
  manifest: AssetCurationManifestV1,
  assets: AssetsDocument,
  input: {
    readonly assetId: string;
    readonly favorite: boolean;
    readonly decision: AssetCurationRecord["decision"];
    readonly note?: string | null;
    readonly updatedAt: string;
    readonly actorId: string;
    readonly resultingRevisionId: string;
  },
): AssetCurationMutationResult => {
  if (manifest.projectId !== assets.projectId) {
    throw new Error("Asset curation project identity does not match assets.json.");
  }
  const knownAssetIds = new Set(assets.assets.map((asset) => asset.id));
  if (!knownAssetIds.has(input.assetId)) throw new Error(`Unknown asset ID: ${input.assetId}.`);
  const before = manifest.records.find((record) => record.assetId === input.assetId) ?? null;
  const after: AssetCurationRecord = {
    assetId: input.assetId,
    favorite: input.favorite,
    decision: input.decision,
    note: normalizeNote(input.note),
    updatedAt: input.updatedAt,
    actorId: input.actorId,
  };
  assertRecord(after);
  const mutation: AssetCurationMutationV1 = {
    schemaVersion: "1.0.0",
    assetId: input.assetId,
    fromRevisionId: manifest.revisionId,
    toRevisionId: input.resultingRevisionId,
    before,
    after,
  };
  const next = applyAssetCurationMutation(manifest, mutation, knownAssetIds);
  return {
    manifest: next,
    mutation,
    inverse: {
      ...mutation,
      fromRevisionId: mutation.toRevisionId,
      toRevisionId: mutation.fromRevisionId,
      before: mutation.after,
      after: mutation.before,
    },
  };
};

const normalizeNote = (note: string | null | undefined): string | null => {
  const normalized = note?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
};

export const applyAssetCurationMutation = (
  manifest: AssetCurationManifestV1,
  mutation: AssetCurationMutationV1,
  knownAssetIds: ReadonlySet<string>,
): AssetCurationManifestV1 => {
  const validated = createAssetCurationManifest({ ...manifest, knownAssetIds });
  if (validated.revisionId !== mutation.fromRevisionId) {
    throw new Error("Asset curation mutation base revision does not match.");
  }
  const current = validated.records.find((record) => record.assetId === mutation.assetId) ?? null;
  if (JSON.stringify(current) !== JSON.stringify(mutation.before)) {
    throw new Error("Asset curation mutation precondition failed.");
  }
  const records = validated.records.filter((record) => record.assetId !== mutation.assetId);
  if (mutation.after !== null) records.push(mutation.after);
  return createAssetCurationManifest({
    projectId: validated.projectId,
    revisionId: mutation.toRevisionId,
    records,
    knownAssetIds,
  });
};

export const serializeAssetCurationManifest = (manifest: AssetCurationManifestV1): string =>
  `${JSON.stringify(createAssetCurationManifest(manifest), null, 2)}\n`;

export const assetCurationManifestToAssetRecord = (
  manifest: AssetCurationManifestV1,
  id: string,
  registryPath = "assets/metadata/asset-curation.json",
): AssetRecord => ({
  id,
  path: registryPath,
  contentHash: createHash("sha256").update(serializeAssetCurationManifest(manifest)).digest("hex"),
  kind: "data",
  durationFrames: null,
  fps: null,
  hasAudio: false,
  hasAlpha: false,
  variableFrameRate: false,
  rights: "owned",
  validationState: "valid",
});

export const buildDuplicateReviewQueue = (
  duplicateGroups: readonly AssetDuplicateGroup[],
  manifest: AssetCurationManifestV1,
): readonly DuplicateReviewGroup[] => {
  const records = new Map(manifest.records.map((record) => [record.assetId, record]));
  return [...duplicateGroups]
    .sort((left, right) => left.contentHash.localeCompare(right.contentHash, "en"))
    .map((group) => {
      const assetIds = [...group.assetIds].sort((left, right) => left.localeCompare(right, "en"));
      const approvedAssetIds = assetIds.filter((assetId) => records.get(assetId)?.decision === "approved");
      const rejectedAssetIds = assetIds.filter((assetId) => records.get(assetId)?.decision === "rejected");
      const favoriteAssetIds = assetIds.filter((assetId) => records.get(assetId)?.favorite === true);
      const pendingAssetIds = assetIds.filter(
        (assetId) => (records.get(assetId)?.decision ?? "unreviewed") === "unreviewed",
      );
      const reviewedCount = assetIds.length - pendingAssetIds.length;
      return {
        contentHash: group.contentHash,
        assetIds,
        approvedAssetIds,
        rejectedAssetIds,
        favoriteAssetIds,
        pendingAssetIds,
        reviewState:
          reviewedCount === 0 ? "unreviewed" : pendingAssetIds.length === 0 ? "resolved" : "in-progress",
      };
    });
};

const assertRecord = (record: AssetCurationRecord): void => {
  if (
    !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(record.assetId) ||
    record.actorId.trim().length === 0 ||
    Number.isNaN(Date.parse(record.updatedAt)) ||
    (record.note !== null && (record.note.trim().length === 0 || record.note.length > 2_000))
  ) {
    throw new Error(`Invalid asset curation record: ${record.assetId}.`);
  }
};
