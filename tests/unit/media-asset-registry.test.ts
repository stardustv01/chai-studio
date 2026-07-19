import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditAssetRegistry,
  normalizeAssetRegistryPath,
  prepareAssetRegistration,
  registerAssetRecord,
} from "../../packages/media/src/index.js";
import type { AssetsDocument } from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("authoritative asset registration", () => {
  it("hashes complete source bytes and creates a canonical pending record", async () => {
    const directory = await temporaryDirectory();
    const source = path.join(directory, "opening.mov");
    const bytes = Buffer.from("deterministic-media-fixture");
    await writeFile(source, bytes);
    const asset = await prepareAssetRegistration({
      id: "asset-opening-0001",
      sourceFilePath: source,
      projectRelativePath: "assets\\opening.mov",
      kind: "video",
      rights: "owned",
    });
    expect(asset).toEqual({
      id: "asset-opening-0001",
      path: "assets/opening.mov",
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      kind: "video",
      durationFrames: null,
      fps: null,
      hasAudio: false,
      hasAlpha: false,
      variableFrameRate: false,
      rights: "owned",
      validationState: "pending",
    });
  });

  it("registers immutably and remains authoritative after source/cache deletion", async () => {
    const directory = await temporaryDirectory();
    const source = path.join(directory, "voice.wav");
    await writeFile(source, "voice-bytes");
    const asset = await prepareAssetRegistration({
      id: "asset-voice-0001",
      sourceFilePath: source,
      projectRelativePath: "assets/voice.wav",
      kind: "audio",
      rights: "licensed",
    });
    const original = emptyAssetsDocument();
    const registered = registerAssetRecord(original, asset);
    expect(original.assets).toEqual([]);
    expect(registered.assets).toEqual([asset]);
    await rm(directory, { recursive: true, force: true });
    temporaryDirectories.splice(temporaryDirectories.indexOf(directory), 1);
    expect(auditAssetRegistry(registered)).toEqual({ passed: true, assetCount: 1, issues: [] });
  });

  it("rejects duplicate identity, duplicate canonical paths, and traversal", () => {
    const original = emptyAssetsDocument();
    const asset = fixtureAsset("asset-first-0001", "assets/first.mov");
    const registered = registerAssetRecord(original, asset);
    expect(() => registerAssetRecord(registered, asset)).toThrow(/Asset ID already exists/);
    expect(() =>
      registerAssetRecord(registered, fixtureAsset("asset-second-0001", "assets/first.mov")),
    ).toThrow(/path is already registered/);
    expect(() => normalizeAssetRegistryPath("assets/../outside.mov")).toThrow(/not canonical/);
    expect(() => normalizeAssetRegistryPath("/absolute/outside.mov")).toThrow(/not canonical/);
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-media-registry-"));
  temporaryDirectories.push(directory);
  return directory;
};

const emptyAssetsDocument = (): AssetsDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-media-0001",
  revisionId: "revision-media-0001",
  assets: [],
});

const fixtureAsset = (id: string, assetPath: string): AssetsDocument["assets"][number] => ({
  id,
  path: assetPath,
  contentHash: "a".repeat(64),
  kind: "video",
  durationFrames: null,
  fps: null,
  hasAudio: false,
  hasAlpha: false,
  variableFrameRate: false,
  rights: "unknown",
  validationState: "pending",
});
