import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectAssetSourceChanges, findDuplicateAssets } from "../../packages/media/src/index.js";
import type { AssetRecord, AssetsDocument } from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("asset duplicate and source-change detection", () => {
  it("groups duplicate content identities without merging stable records", () => {
    const sharedHash = hash("shared");
    const document = assetsDocument([
      asset("asset-duplicate-0001", "assets/a.mov", sharedHash),
      asset("asset-duplicate-0002", "assets/b.mov", sharedHash),
      asset("asset-unique-0001", "assets/c.mov", hash("unique")),
    ]);
    expect(findDuplicateAssets(document)).toEqual([
      {
        contentHash: sharedHash,
        assetIds: ["asset-duplicate-0001", "asset-duplicate-0002"],
        paths: ["assets/a.mov", "assets/b.mov"],
      },
    ]);
    expect(document.assets).toHaveLength(3);
  });

  it("distinguishes unchanged, changed, moved, moved-and-changed, and missing sources", async () => {
    const directory = await temporaryDirectory();
    const unchangedFile = await fixtureFile(directory, "unchanged.mov", "same");
    const changedFile = await fixtureFile(directory, "changed.mov", "new-content");
    const movedFile = await fixtureFile(directory, "moved.mov", "move-same");
    const movedChangedFile = await fixtureFile(directory, "moved-changed.mov", "move-new");
    const document = assetsDocument([
      asset("asset-unchanged-0001", "assets/unchanged.mov", hash("same")),
      asset("asset-changed-0001", "assets/changed.mov", hash("old-content")),
      asset("asset-moved-0001", "assets/old-name.mov", hash("move-same")),
      asset("asset-moved-changed-0001", "assets/old-other.mov", hash("move-old")),
      asset("asset-missing-0001", "assets/missing.mov", hash("missing")),
    ]);
    const results = await detectAssetSourceChanges(document, [
      {
        assetId: "asset-unchanged-0001",
        registryPath: "assets/unchanged.mov",
        sourceFilePath: unchangedFile,
      },
      { assetId: "asset-changed-0001", registryPath: "assets/changed.mov", sourceFilePath: changedFile },
      { assetId: "asset-moved-0001", registryPath: "assets/moved.mov", sourceFilePath: movedFile },
      {
        assetId: "asset-moved-changed-0001",
        registryPath: "assets/moved-changed.mov",
        sourceFilePath: movedChangedFile,
      },
      {
        assetId: "asset-missing-0001",
        registryPath: "assets/missing.mov",
        sourceFilePath: path.join(directory, "missing.mov"),
      },
    ]);
    expect(Object.fromEntries(results.map((result) => [result.assetId, result.state]))).toEqual({
      "asset-changed-0001": "content-changed",
      "asset-missing-0001": "missing",
      "asset-moved-0001": "path-changed",
      "asset-moved-changed-0001": "path-and-content-changed",
      "asset-unchanged-0001": "unchanged",
    });
    expect(results.filter((result) => result.requiresExplicitRelinkOrReplace)).toHaveLength(4);
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-media-change-"));
  temporaryDirectories.push(directory);
  return directory;
};

const fixtureFile = async (directory: string, name: string, content: string): Promise<string> => {
  const file = path.join(directory, name);
  await writeFile(file, content);
  return file;
};

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

const assetsDocument = (assets: readonly AssetRecord[]): AssetsDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-change-0001",
  revisionId: "revision-change-0001",
  assets,
});

const asset = (id: string, assetPath: string, contentHash: string): AssetRecord => ({
  id,
  path: assetPath,
  contentHash,
  kind: "video",
  durationFrames: null,
  fps: null,
  hasAudio: false,
  hasAlpha: false,
  variableFrameRate: false,
  rights: "owned",
  validationState: "valid",
});
