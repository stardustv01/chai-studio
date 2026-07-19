import { createHash } from "node:crypto";
import path from "node:path";
import {
  assertProjectDocument,
  type AssetRecord,
  type AssetsDocument,
  type TimelineDocument,
} from "@chai-studio/schema";
import { normalizeAssetRegistryPath } from "./asset-registry.js";
import {
  authorizeAssetPath,
  type ApprovedExternalAssetRoot,
  type AuthorizedAssetPath,
} from "./path-policy.js";

export interface AssetMutationV1 {
  readonly schemaVersion: "1.0.0";
  readonly operation: "relink" | "replace";
  readonly projectId: string;
  readonly assetId: string;
  readonly fromRevisionId: string;
  readonly toRevisionId: string;
  readonly before: AssetRecord;
  readonly after: AssetRecord;
}

export interface ReversibleAssetTransactionV1 {
  readonly schemaVersion: "1.0.0";
  readonly transactionId: string;
  readonly mutation: AssetMutationV1;
  readonly inverse: AssetMutationV1;
  readonly invalidatedSourceContentHashes: readonly string[];
  readonly summary: string;
}

export interface AssetMutationResult {
  readonly document: AssetsDocument;
  readonly transaction: ReversibleAssetTransactionV1;
}

export interface AssetUsageLocation {
  readonly timelineId: string;
  readonly trackId: string;
  readonly trackName: string;
  readonly clipId: string;
}

export interface AssetUsageReport {
  readonly assetId: string;
  readonly usageCount: number;
  readonly timelineCount: number;
  readonly locations: readonly AssetUsageLocation[];
}

export interface RevealAssetPlan {
  readonly assetId: string;
  readonly authorizedPath: AuthorizedAssetPath;
  readonly executable: "/usr/bin/open";
  readonly arguments: readonly ["-R", string];
}

export const createAssetRelinkTransaction = (
  document: AssetsDocument,
  input: {
    readonly assetId: string;
    readonly registryPath: string;
    readonly observedContentHash: string;
    readonly resultingRevisionId: string;
  },
): AssetMutationResult => {
  const before = requireAsset(document, input.assetId);
  if (input.observedContentHash !== before.contentHash) {
    throw new Error(
      `Relink refused for ${input.assetId}: selected bytes do not match the registered content hash. Use replace instead.`,
    );
  }
  return createTransaction(document, {
    schemaVersion: "1.0.0",
    operation: "relink",
    projectId: document.projectId,
    assetId: input.assetId,
    fromRevisionId: document.revisionId,
    toRevisionId: input.resultingRevisionId,
    before,
    after: {
      ...before,
      path: normalizeAssetRegistryPath(input.registryPath),
      validationState: "valid",
    },
  });
};

export const createAssetReplaceTransaction = (
  document: AssetsDocument,
  input: {
    readonly assetId: string;
    readonly replacement: AssetRecord;
    readonly resultingRevisionId: string;
  },
): AssetMutationResult => {
  const before = requireAsset(document, input.assetId);
  if (input.replacement.id !== input.assetId) {
    throw new Error("Replacement must preserve the logical asset ID so timeline references remain stable.");
  }
  return createTransaction(document, {
    schemaVersion: "1.0.0",
    operation: "replace",
    projectId: document.projectId,
    assetId: input.assetId,
    fromRevisionId: document.revisionId,
    toRevisionId: input.resultingRevisionId,
    before,
    after: { ...input.replacement, path: normalizeAssetRegistryPath(input.replacement.path) },
  });
};

export const applyAssetMutation = (document: AssetsDocument, mutation: AssetMutationV1): AssetsDocument => {
  assertProjectDocument("assets", document);
  if (document.projectId !== mutation.projectId || document.revisionId !== mutation.fromRevisionId) {
    throw new Error("Asset mutation base project or revision does not match the current document.");
  }
  const current = requireAsset(document, mutation.assetId);
  if (canonicalJson(current) !== canonicalJson(mutation.before)) {
    throw new Error("Asset mutation precondition failed because the registered asset changed.");
  }
  if (mutation.after.id !== mutation.assetId || mutation.before.id !== mutation.assetId) {
    throw new Error("Asset mutation cannot change logical identity.");
  }
  if (mutation.operation === "relink" && mutation.before.contentHash !== mutation.after.contentHash) {
    throw new Error("Relink mutations cannot change content bytes.");
  }
  if (document.assets.some((asset) => asset.id !== mutation.assetId && asset.path === mutation.after.path)) {
    throw new Error(`Asset path is already registered: ${mutation.after.path}.`);
  }
  const candidate: AssetsDocument = {
    ...document,
    revisionId: mutation.toRevisionId,
    assets: document.assets.map((asset) => (asset.id === mutation.assetId ? mutation.after : asset)),
  };
  return assertProjectDocument("assets", candidate);
};

export const buildAssetUsageReport = (
  assetId: string,
  timelines: readonly TimelineDocument[],
): AssetUsageReport => {
  const locations = timelines
    .flatMap((timeline) =>
      timeline.tracks.flatMap((track) =>
        track.clips
          .filter((clip) => clip.assetId === assetId)
          .map((clip) => ({
            timelineId: timeline.timelineId,
            trackId: track.id,
            trackName: track.name,
            clipId: clip.id,
          })),
      ),
    )
    .sort((left, right) =>
      `${left.timelineId}\u0000${left.trackId}\u0000${left.clipId}`.localeCompare(
        `${right.timelineId}\u0000${right.trackId}\u0000${right.clipId}`,
        "en",
      ),
    );
  return {
    assetId,
    usageCount: locations.length,
    timelineCount: new Set(locations.map((location) => location.timelineId)).size,
    locations,
  };
};

export const createRevealAssetPlan = async (input: {
  readonly asset: AssetRecord;
  readonly projectRoot: string;
  readonly approvedExternalRoots?: readonly ApprovedExternalAssetRoot[];
}): Promise<RevealAssetPlan> => {
  const candidatePath = resolveRegistryPath(
    input.projectRoot,
    input.asset.path,
    input.approvedExternalRoots ?? [],
  );
  const authorizedPath = await authorizeAssetPath({
    projectRoot: input.projectRoot,
    candidatePath,
    ...(input.approvedExternalRoots === undefined
      ? {}
      : { approvedExternalRoots: input.approvedExternalRoots }),
  });
  return {
    assetId: input.asset.id,
    authorizedPath,
    executable: "/usr/bin/open",
    arguments: ["-R", authorizedPath.canonicalPath],
  };
};

const resolveRegistryPath = (
  projectRoot: string,
  registryPath: string,
  externalRoots: readonly ApprovedExternalAssetRoot[],
): string => {
  const segments = registryPath.split("/");
  if (segments[0] !== "external") return path.join(projectRoot, registryPath);
  const rootId = segments[1];
  const root = externalRoots.find((candidate) => candidate.id === rootId);
  if (root === undefined || segments.length < 3) {
    throw new Error(`Asset external root is not approved: ${rootId ?? "missing"}.`);
  }
  return path.join(root.path, ...segments.slice(2));
};

const createTransaction = (document: AssetsDocument, mutation: AssetMutationV1): AssetMutationResult => {
  const inverse: AssetMutationV1 = {
    ...mutation,
    fromRevisionId: mutation.toRevisionId,
    toRevisionId: mutation.fromRevisionId,
    before: mutation.after,
    after: mutation.before,
  };
  const invalidatedSourceContentHashes = [
    ...new Set([mutation.before.contentHash, mutation.after.contentHash]),
  ].sort((left, right) => left.localeCompare(right, "en"));
  const transaction: ReversibleAssetTransactionV1 = {
    schemaVersion: "1.0.0",
    transactionId: createHash("sha256").update(canonicalJson(mutation)).digest("hex"),
    mutation,
    inverse,
    invalidatedSourceContentHashes,
    summary:
      mutation.operation === "relink"
        ? `Relink ${mutation.assetId} without changing content identity.`
        : `Replace source bytes for ${mutation.assetId} while preserving logical identity.`,
  };
  return { document: applyAssetMutation(document, mutation), transaction };
};

const requireAsset = (document: AssetsDocument, assetId: string): AssetRecord => {
  assertProjectDocument("assets", document);
  const asset = document.assets.find((candidate) => candidate.id === assetId);
  if (asset === undefined) throw new Error(`Unknown asset ID: ${assetId}.`);
  return asset;
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};
