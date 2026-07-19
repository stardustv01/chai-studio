import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyAssetCurationMutation,
  applyAssetMutation,
  assetCurationManifestToAssetRecord,
  buildDuplicateReviewQueue,
  buildAssetUsageReport,
  createAssetCurationManifest,
  createAssetRelinkTransaction,
  createAssetReplaceTransaction,
  createRevealAssetPlan,
  updateAssetCuration,
} from "../../packages/media/src/index.js";
import {
  normalizeRational,
  serializeBigInt,
  type AssetRecord,
  type AssetsDocument,
  type TimelineDocument,
} from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("reversible asset workflows", () => {
  it("relinks only identical bytes and restores the original record through its inverse", () => {
    const original = assetsDocument();
    expect(() =>
      createAssetRelinkTransaction(original, {
        assetId: "asset-video-0001",
        registryPath: "media/relinked.mov",
        observedContentHash: "f".repeat(64),
        resultingRevisionId: "revision-relinked",
      }),
    ).toThrow(/Use replace instead/);

    const result = createAssetRelinkTransaction(original, {
      assetId: "asset-video-0001",
      registryPath: "media/relinked.mov",
      observedContentHash: "a".repeat(64),
      resultingRevisionId: "revision-relinked",
    });
    expect(result.document).toMatchObject({ revisionId: "revision-relinked" });
    expect(result.document.assets[0]).toMatchObject({
      path: "media/relinked.mov",
      contentHash: "a".repeat(64),
      validationState: "valid",
    });
    expect(applyAssetMutation(result.document, result.transaction.inverse)).toEqual(original);
    expect(result.transaction.transactionId).toHaveLength(64);
  });

  it("replaces source bytes while preserving identity and reports both cache invalidations", () => {
    const original = assetsDocument();
    const replacement: AssetRecord = {
      ...firstAsset(original),
      path: "media/replacement.mov",
      contentHash: "c".repeat(64),
      durationFrames: serializeBigInt(600n),
    };
    const result = createAssetReplaceTransaction(original, {
      assetId: "asset-video-0001",
      replacement,
      resultingRevisionId: "revision-replaced",
    });
    expect(result.document.assets[0]).toEqual(replacement);
    expect(result.transaction.invalidatedSourceContentHashes).toEqual(["a".repeat(64), "c".repeat(64)]);
    expect(applyAssetMutation(result.document, result.transaction.inverse)).toEqual(original);
    expect(() =>
      createAssetReplaceTransaction(original, {
        assetId: "asset-video-0001",
        replacement: { ...replacement, id: "asset-different-0001" },
        resultingRevisionId: "revision-bad",
      }),
    ).toThrow(/preserve the logical asset ID/);
  });

  it("builds deterministic timeline usage reports", () => {
    const report = buildAssetUsageReport("asset-video-0001", [
      timeline("timeline-b", "clip-b"),
      timeline("timeline-a", "clip-a"),
    ]);
    expect(report).toMatchObject({ assetId: "asset-video-0001", usageCount: 2, timelineCount: 2 });
    expect(report.locations.map((location) => location.timelineId)).toEqual(["timeline-a", "timeline-b"]);
  });

  it("creates a macOS reveal plan only after resolving a real authorized file", async () => {
    const projectRoot = await temporaryDirectory();
    await mkdir(path.join(projectRoot, "media"));
    await writeFile(path.join(projectRoot, "media", "source.mov"), "fixture");
    const plan = await createRevealAssetPlan({ asset: firstAsset(assetsDocument()), projectRoot });
    expect(plan.executable).toBe("/usr/bin/open");
    expect(plan.arguments).toEqual(["-R", await realpath(path.join(projectRoot, "media", "source.mov"))]);
  });
});

describe("versioned asset review metadata", () => {
  it("updates, hashes, and reverses favorite and approval state without extending assets.json", () => {
    const assets = assetsDocument();
    const empty = createAssetCurationManifest({
      projectId: assets.projectId,
      revisionId: assets.revisionId,
      records: [],
      knownAssetIds: new Set(assets.assets.map((asset) => asset.id)),
    });
    const result = updateAssetCuration(empty, assets, {
      assetId: "asset-video-0001",
      favorite: true,
      decision: "approved",
      note: "Primary hero source",
      updatedAt: "2026-07-15T10:00:00.000Z",
      actorId: "user-navin",
      resultingRevisionId: "revision-curated",
    });
    expect(result.manifest.records[0]).toMatchObject({ favorite: true, decision: "approved" });
    expect(assetCurationManifestToAssetRecord(result.manifest, "asset-curation-0001")).toMatchObject({
      kind: "data",
      validationState: "valid",
    });
    expect(
      applyAssetCurationMutation(
        result.manifest,
        result.inverse,
        new Set(assets.assets.map((asset) => asset.id)),
      ),
    ).toEqual(empty);
  });

  it("rejects review records for unknown assets", () => {
    const assets = assetsDocument();
    const empty = createAssetCurationManifest({
      projectId: assets.projectId,
      revisionId: assets.revisionId,
      records: [],
    });
    expect(() =>
      updateAssetCuration(empty, assets, {
        assetId: "asset-unknown-0001",
        favorite: false,
        decision: "rejected",
        updatedAt: "2026-07-15T10:00:00.000Z",
        actorId: "user-navin",
        resultingRevisionId: "revision-curated",
      }),
    ).toThrow(/Unknown asset ID/);
  });

  it("combines duplicate hashes with pending, approved, rejected, and favorite review state", () => {
    const manifest = createAssetCurationManifest({
      projectId: "project-media",
      revisionId: "revision-curation",
      records: [
        {
          assetId: "asset-audio-0001",
          favorite: true,
          decision: "approved",
          note: null,
          updatedAt: "2026-07-15T10:00:00.000Z",
          actorId: "user-navin",
        },
      ],
    });
    expect(
      buildDuplicateReviewQueue(
        [
          {
            contentHash: "b".repeat(64),
            assetIds: ["asset-video-0001", "asset-audio-0001"],
            paths: ["media/source.mov", "media/audio.wav"],
          },
        ],
        manifest,
      ),
    ).toEqual([
      {
        contentHash: "b".repeat(64),
        assetIds: ["asset-audio-0001", "asset-video-0001"],
        approvedAssetIds: ["asset-audio-0001"],
        rejectedAssetIds: [],
        favoriteAssetIds: ["asset-audio-0001"],
        pendingAssetIds: ["asset-video-0001"],
        reviewState: "in-progress",
      },
    ]);
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-asset-workflows-"));
  temporaryDirectories.push(directory);
  return directory;
};

const assetsDocument = (): AssetsDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-media",
  revisionId: "revision-original",
  assets: [
    {
      id: "asset-video-0001",
      path: "media/source.mov",
      contentHash: "a".repeat(64),
      kind: "video",
      durationFrames: serializeBigInt(300n),
      fps: normalizeRational(30n, 1n),
      hasAudio: true,
      hasAlpha: false,
      variableFrameRate: false,
      rights: "owned",
      validationState: "missing",
    },
    {
      id: "asset-audio-0001",
      path: "media/audio.wav",
      contentHash: "b".repeat(64),
      kind: "audio",
      durationFrames: serializeBigInt(300n),
      fps: normalizeRational(30n, 1n),
      hasAudio: true,
      hasAlpha: false,
      variableFrameRate: false,
      rights: "licensed",
      validationState: "valid",
    },
  ],
});

const firstAsset = (document: AssetsDocument): AssetRecord => {
  const asset = document.assets[0];
  if (asset === undefined) throw new Error("Fixture requires a primary asset.");
  return asset;
};

const timeline = (timelineId: string, clipId: string): TimelineDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-media",
  revisionId: "revision-original",
  timelineId,
  fps: normalizeRational(30n, 1n),
  durationFrames: serializeBigInt(300n),
  tracks: [
    {
      id: `track-${timelineId}`,
      kind: "video",
      name: `Video ${timelineId}`,
      order: 0,
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
      clips: [
        {
          id: clipId,
          assetId: "asset-video-0001",
          engine: "shared",
          startFrame: serializeBigInt(0n),
          durationFrames: serializeBigInt(30n),
          sourceInFrame: serializeBigInt(0n),
          sourceDurationFrames: serializeBigInt(30n),
          capability: "native",
          audioBusId: null,
        },
      ],
    },
  ],
  audioBusIds: [],
  approvalReferenceIds: [],
});
