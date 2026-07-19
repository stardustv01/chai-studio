import { describe, expect, it } from "vitest";
import {
  assetRightsManifestToAssetRecord,
  createAssetRightsManifest,
  fingerprintAssetRightsManifest,
  preflightDeliveryRights,
  type AssetRightsRecord,
  type DeliveryRightsPolicy,
} from "../../packages/media/src/index.js";
import { normalizeRational, serializeBigInt, type AssetsDocument } from "../../packages/schema/src/index.js";

describe("detailed asset rights and delivery preflight", () => {
  it("normalizes and fingerprints reviewed evidence deterministically", () => {
    const assets = fixtureAssets();
    const first = createAssetRightsManifest({
      projectId: assets.projectId,
      revisionId: assets.revisionId,
      records: [licensedRights(), ownedRights()],
      assets,
    });
    const second = createAssetRightsManifest({
      projectId: assets.projectId,
      revisionId: assets.revisionId,
      records: [ownedRights(), licensedRights()],
      assets,
    });
    expect(first).toEqual(second);
    expect(fingerprintAssetRightsManifest(first)).toHaveLength(64);
    expect(assetRightsManifestToAssetRecord(first, "asset-rights-0001")).toMatchObject({
      kind: "data",
      contentHash: fingerprintAssetRightsManifest(first),
    });
  });

  it("passes cleared delivery when proof, territory, use, and attribution satisfy policy", () => {
    const assets = fixtureAssets();
    const manifest = createAssetRightsManifest({
      projectId: assets.projectId,
      revisionId: assets.revisionId,
      records: [ownedRights(), licensedRights()],
      assets,
    });
    const report = preflightDeliveryRights({
      assets,
      manifest,
      deliveryAssetIds: ["asset-licensed-0001", "asset-owned-0001"],
      policy: fixturePolicy(),
    });
    expect(report).toMatchObject({ passed: true, blockerCount: 0, warningCount: 0 });
    expect(report.assetIds).toEqual(["asset-licensed-0001", "asset-owned-0001"]);
  });

  it("blocks expired, territory-limited, prohibited, unattributed, and unproven rights", () => {
    const assets = fixtureAssets();
    const broken: AssetRightsRecord = {
      ...licensedRights(),
      proofs: [],
      expiresAt: "2026-01-01T00:00:00.000Z",
      permittedTerritories: ["US"],
      prohibitedUses: ["advertising"],
    };
    const manifest = createAssetRightsManifest({
      projectId: assets.projectId,
      revisionId: assets.revisionId,
      records: [ownedRights(), broken],
      assets,
    });
    const policy = { ...fixturePolicy(), attributionByAssetId: {} };
    const report = preflightDeliveryRights({
      assets,
      manifest,
      deliveryAssetIds: ["asset-licensed-0001"],
      policy,
    });
    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual([
      "rights.attribution-missing",
      "rights.expired",
      "rights.proof-missing",
      "rights.territory-blocked",
      "rights.use-prohibited",
    ]);
  });

  it("supports explicit warning policy for missing details while always blocking mismatches", () => {
    const assets = fixtureAssets();
    const manifest = createAssetRightsManifest({
      projectId: assets.projectId,
      revisionId: assets.revisionId,
      records: [{ ...ownedRights(), classification: "licensed" }],
      assets,
    });
    const missing = preflightDeliveryRights({
      assets,
      manifest,
      deliveryAssetIds: ["asset-licensed-0001"],
      policy: { ...fixturePolicy(), missingDetails: "warn" },
    });
    expect(missing).toMatchObject({ passed: true, blockerCount: 0, warningCount: 1 });

    const mismatch = preflightDeliveryRights({
      assets,
      manifest,
      deliveryAssetIds: ["asset-owned-0001"],
      policy: fixturePolicy(),
    });
    expect(mismatch.issues.some((issue) => issue.code === "rights.classification-mismatch")).toBe(true);
    expect(mismatch.passed).toBe(false);
  });
});

const fixturePolicy = (): DeliveryRightsPolicy => ({
  missingDetails: "block",
  unknownClassification: "block",
  requireProofFor: ["licensed"],
  territory: "IN",
  useTags: ["advertising", "online-video"],
  attributionByAssetId: { "asset-licensed-0001": "Music by Example Artist" },
  asOf: "2026-07-15T12:00:00.000Z",
});

const ownedRights = (): AssetRightsRecord => ({
  assetId: "asset-owned-0001",
  classification: "owned",
  creator: "Navin",
  sourceUrl: null,
  licenseName: null,
  licenseUrl: null,
  attribution: null,
  permittedTerritories: ["worldwide"],
  prohibitedUses: [],
  restrictions: [],
  proofs: [],
  expiresAt: null,
  reviewedAt: "2026-07-01T00:00:00.000Z",
  reviewedBy: "user-navin",
});

const licensedRights = (): AssetRightsRecord => ({
  assetId: "asset-licensed-0001",
  classification: "licensed",
  creator: "Example Artist",
  sourceUrl: "https://assets.example/source",
  licenseName: "Commercial Web License",
  licenseUrl: "https://assets.example/license",
  attribution: "Music by Example Artist",
  permittedTerritories: ["worldwide"],
  prohibitedUses: [],
  restrictions: ["No standalone redistribution"],
  proofs: [{ registryPath: "assets/rights/license.pdf", contentHash: "e".repeat(64) }],
  expiresAt: "2027-07-15T00:00:00.000Z",
  reviewedAt: "2026-07-01T00:00:00.000Z",
  reviewedBy: "user-navin",
});

const fixtureAssets = (): AssetsDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-rights",
  revisionId: "revision-rights",
  assets: [
    {
      id: "asset-owned-0001",
      path: "media/owned.mov",
      contentHash: "a".repeat(64),
      kind: "video",
      durationFrames: serializeBigInt(300n),
      fps: normalizeRational(30n, 1n),
      hasAudio: true,
      hasAlpha: false,
      variableFrameRate: false,
      rights: "owned",
      validationState: "valid",
    },
    {
      id: "asset-licensed-0001",
      path: "media/licensed.wav",
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
