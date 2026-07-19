import { stat } from "node:fs/promises";
import type { AssetRecord, AssetsDocument } from "@chai-studio/schema";
import { normalizeAssetRegistryPath, sha256File } from "./asset-registry.js";

export interface AssetDuplicateGroup {
  readonly contentHash: string;
  readonly assetIds: readonly string[];
  readonly paths: readonly string[];
}

export interface AssetSourceObservation {
  readonly assetId: string;
  readonly registryPath: string;
  readonly sourceFilePath: string;
}

export type AssetSourceChangeState =
  "unchanged" | "missing" | "content-changed" | "path-changed" | "path-and-content-changed";

export interface AssetSourceChange {
  readonly assetId: string;
  readonly state: AssetSourceChangeState;
  readonly expectedPath: string;
  readonly observedPath: string;
  readonly expectedContentHash: string;
  readonly observedContentHash: string | null;
  readonly requiresExplicitRelinkOrReplace: boolean;
}

export const findDuplicateAssets = (document: AssetsDocument): readonly AssetDuplicateGroup[] => {
  const byHash = new Map<string, AssetRecord[]>();
  for (const asset of document.assets) {
    const values = byHash.get(asset.contentHash) ?? [];
    values.push(asset);
    byHash.set(asset.contentHash, values);
  }
  return [...byHash.entries()]
    .filter(([, assets]) => assets.length > 1)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([contentHash, assets]) => ({
      contentHash,
      assetIds: assets.map((asset) => asset.id).sort((left, right) => left.localeCompare(right, "en")),
      paths: assets.map((asset) => asset.path).sort((left, right) => left.localeCompare(right, "en")),
    }));
};

export const detectAssetSourceChanges = async (
  document: AssetsDocument,
  observations: readonly AssetSourceObservation[],
): Promise<readonly AssetSourceChange[]> => {
  const assetsById = new Map(document.assets.map((asset) => [asset.id, asset]));
  const results = await Promise.all(
    observations.map(async (observation): Promise<AssetSourceChange> => {
      const asset = assetsById.get(observation.assetId);
      if (asset === undefined) throw new Error(`Unknown observed asset ID: ${observation.assetId}.`);
      const observedPath = normalizeAssetRegistryPath(observation.registryPath);
      const pathChanged = observedPath !== asset.path;
      const exists = await stat(observation.sourceFilePath)
        .then((value) => value.isFile())
        .catch(() => false);
      if (!exists) {
        return {
          assetId: asset.id,
          state: "missing",
          expectedPath: asset.path,
          observedPath,
          expectedContentHash: asset.contentHash,
          observedContentHash: null,
          requiresExplicitRelinkOrReplace: true,
        };
      }
      const observedContentHash = await sha256File(observation.sourceFilePath);
      const contentChanged = observedContentHash !== asset.contentHash;
      const state: AssetSourceChangeState = pathChanged
        ? contentChanged
          ? "path-and-content-changed"
          : "path-changed"
        : contentChanged
          ? "content-changed"
          : "unchanged";
      return {
        assetId: asset.id,
        state,
        expectedPath: asset.path,
        observedPath,
        expectedContentHash: asset.contentHash,
        observedContentHash,
        requiresExplicitRelinkOrReplace: state !== "unchanged",
      };
    }),
  );
  return results.sort((left, right) => left.assetId.localeCompare(right.assetId, "en"));
};
