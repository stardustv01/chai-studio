import { describe, expect, it } from "vitest";
import {
  buildAssetIndex,
  parseFfprobeOutput,
  searchAssetIndex,
  type AssetSearchQuery,
} from "../../packages/media/src/index.js";
import {
  normalizeRational,
  serializeBigInt,
  type AssetRecord,
  type AssetsDocument,
} from "../../packages/schema/src/index.js";

const hashes = {
  alpha: "a".repeat(64),
  beta: "b".repeat(64),
  gamma: "c".repeat(64),
  missing: "d".repeat(64),
};

describe("rebuildable asset index", () => {
  it("derives names, exact duration, resolution, dates, and usage from authoritative sources", () => {
    const index = fixtureIndex();
    expect(index.map((entry) => entry.id)).toEqual([
      "asset-alpha",
      "asset-beta",
      "asset-gamma",
      "asset-missing",
    ]);
    expect(index[0]).toMatchObject({
      name: "Alpha.mov",
      durationSeconds: { numerator: "10", denominator: "1" },
      width: 1920,
      height: 1080,
      registeredAt: "2026-07-01T10:00:00.000Z",
      usageCount: 5,
    });
    expect(index[1]?.durationSeconds).toEqual({ numerator: "20", denominator: "1" });
    expect(index[2]).toMatchObject({ name: "Gamma.png", durationSeconds: null, usageCount: 1 });
  });

  it("combines normalized text, type, rights, state, exact duration, resolution, date, and usage filters", () => {
    const page = searchAssetIndex(fixtureIndex(), {
      ...defaultQuery(),
      text: "ALPHA MOV",
      kinds: ["video"],
      rights: ["owned"],
      validationStates: ["valid"],
      minimumDurationSeconds: normalizeRational(9n, 1n),
      maximumDurationSeconds: normalizeRational(10n, 1n),
      minimumWidth: 1280,
      minimumHeight: 720,
      registeredAfter: "2026-07-01T00:00:00.000Z",
      registeredBefore: "2026-07-02T00:00:00.000Z",
      usedOnly: true,
    });
    expect(page.total).toBe(1);
    expect(page.entries[0]?.id).toBe("asset-alpha");
  });

  it("sorts deterministically, paginates after filtering, and leaves missing resolution last", () => {
    const byUsage = searchAssetIndex(fixtureIndex(), {
      ...defaultQuery(),
      sortBy: "usage",
      direction: "descending",
      offset: 1,
      limit: 2,
    });
    expect(byUsage.total).toBe(4);
    expect(byUsage.entries.map((entry) => entry.id)).toEqual(["asset-gamma", "asset-beta"]);

    const byResolution = searchAssetIndex(fixtureIndex(), {
      ...defaultQuery(),
      sortBy: "resolution",
    });
    expect(byResolution.entries.slice(0, 3).map((entry) => entry.id)).toEqual([
      "asset-beta",
      "asset-gamma",
      "asset-missing",
    ]);
    expect(byResolution.entries[3]?.id).toBe("asset-alpha");
    expect(fixtureIndex()).toEqual(fixtureIndex());
  });

  it("rejects unsafe pagination, invalid source metadata, and invalid date ranges", () => {
    expect(() => searchAssetIndex(fixtureIndex(), { ...defaultQuery(), limit: 0 })).toThrow(/pagination/);
    expect(() =>
      searchAssetIndex(fixtureIndex(), { ...defaultQuery(), registeredAfter: "not-a-date" }),
    ).toThrow(/date range/);
    expect(() =>
      searchAssetIndex(fixtureIndex(), {
        ...defaultQuery(),
        registeredAfter: "2026-08-01T00:00:00.000Z",
        registeredBefore: "2026-07-01T00:00:00.000Z",
      }),
    ).toThrow(/date range/);
    expect(() => buildAssetIndex(fixtureDocument(), { usageCountByAssetId: { "asset-alpha": -1 } })).toThrow(
      /usage count/,
    );
  });
});

const defaultQuery = (): AssetSearchQuery => ({
  sortBy: "name",
  direction: "ascending",
  offset: 0,
  limit: 100,
});

const fixtureIndex = () =>
  buildAssetIndex(fixtureDocument(), {
    inspectionsByContentHash: {
      [hashes.alpha]: videoInspection(hashes.alpha, 1920, 1080, "10.000000"),
    },
    usageCountByAssetId: { "asset-alpha": 5, "asset-beta": 0, "asset-gamma": 1 },
    registeredAtByAssetId: {
      "asset-alpha": "2026-07-01T10:00:00.000Z",
      "asset-beta": "2026-06-15T10:00:00.000Z",
      "asset-gamma": "2026-07-03T10:00:00.000Z",
    },
  });

const fixtureDocument = (): AssetsDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-index",
  revisionId: "revision-index",
  assets: [
    asset("asset-missing", "media/missing.mov", hashes.missing, "video", "unknown", "missing"),
    asset("asset-gamma", "stills/Gamma.png", hashes.gamma, "image", "public-domain", "valid"),
    asset("asset-beta", "audio/beta.wav", hashes.beta, "audio", "licensed", "valid", 960n, 48n),
    asset("asset-alpha", "video/Alpha.mov", hashes.alpha, "video", "owned", "valid", 300n, 30n),
  ],
});

const asset = (
  id: string,
  assetPath: string,
  contentHash: string,
  kind: AssetRecord["kind"],
  rights: AssetRecord["rights"],
  validationState: AssetRecord["validationState"],
  durationFrames?: bigint,
  fps?: bigint,
): AssetRecord => ({
  id,
  path: assetPath,
  contentHash,
  kind,
  durationFrames: durationFrames === undefined ? null : serializeBigInt(durationFrames),
  fps: fps === undefined ? null : normalizeRational(fps, 1n),
  hasAudio: kind === "audio" || kind === "video",
  hasAlpha: false,
  variableFrameRate: false,
  rights,
  validationState,
});

const videoInspection = (contentHash: string, width: number, height: number, duration: string) =>
  parseFfprobeOutput(
    JSON.stringify({
      streams: [
        {
          index: 0,
          codec_name: "h264",
          codec_type: "video",
          pix_fmt: "yuv420p",
          width,
          height,
          r_frame_rate: "30/1",
          avg_frame_rate: "30/1",
          time_base: "1/30000",
          duration,
          nb_frames: "300",
        },
      ],
      format: { format_name: "mov", duration, size: "1024" },
    }),
    contentHash,
    "ffprobe fixture",
  );
