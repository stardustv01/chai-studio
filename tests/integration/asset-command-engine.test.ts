import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  normalizeRational,
  serializeBigInt,
  type AssetManifestUpsertCommand,
  type AssetRecord,
  type AssetRegisterCommand,
  type AssetRelinkCommand,
  type AssetReplaceCommand,
  type HistoryMoveCommand,
  type ProjectCommandEnvelope,
} from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("asset commands through immutable project authority", () => {
  it("registers, relinks, replaces, embeds manifests, invalidates caches, and restores manifests on history moves", async () => {
    const root = await initializedProject();
    const invalidations: Readonly<{ assetId: string; beforeHash: string; afterHash: string }>[] = [];
    const run = async (command: ProjectCommandEnvelope, revisionId: string) =>
      executeProjectCommand(root, command, {
        revisionId,
        now: commandNow,
        invalidateAssetCaches: (event) => {
          invalidations.push(event);
          return Promise.resolve();
        },
      });

    const original = videoAsset("a".repeat(64), "assets/original.mov");
    const registration = await run(registerCommand(original, "revision-assets-0001"), "revision-assets-0002");
    expect(registration, JSON.stringify(registration)).toMatchObject({
      status: "committed",
    });

    expect(await run(relinkCommand("revision-assets-0002"), "revision-assets-0003")).toMatchObject({
      status: "committed",
    });
    expect((await loadCurrentProjectRevision(root)).assets.assets[0]).toMatchObject({
      path: "assets/relinked.mov",
      contentHash: "a".repeat(64),
    });

    const replacement = videoAsset("b".repeat(64), "assets/replacement.mov");
    expect(
      await run(replaceCommand(replacement, "revision-assets-0003"), "revision-assets-0004"),
    ).toMatchObject({ status: "committed" });
    expect(invalidations).toEqual([
      { assetId: original.id, beforeHash: original.contentHash, afterHash: original.contentHash },
      { assetId: original.id, beforeHash: original.contentHash, afterHash: replacement.contentHash },
    ]);

    const content = `${JSON.stringify({ schemaVersion: "1.0.0", records: [] }, null, 2)}\n`;
    const manifest = manifestAsset(content);
    const manifestReceipt = await run(
      manifestCommand(manifest, content, "revision-assets-0004"),
      "revision-assets-0005",
    );
    expect(manifestReceipt, JSON.stringify(manifestReceipt)).toMatchObject({ status: "committed" });
    const afterManifest = await loadCurrentProjectRevision(root);
    expect(afterManifest.project.sources["scenes/shared/project-dependencies/asset-rights.json"]).toEqual({
      engine: "shared",
      contentHash: manifest.contentHash,
      content,
    });
    expect(await readFile(path.join(root, manifest.path), "utf8")).toBe(content);

    expect(
      await run(historyCommand(afterManifest, "history.undo", "undo"), "revision-assets-0006"),
    ).toMatchObject({
      status: "committed",
    });
    await expect(access(path.join(root, manifest.path))).rejects.toThrow();

    const afterUndo = await loadCurrentProjectRevision(root);
    expect(
      await run(historyCommand(afterUndo, "history.redo", "redo"), "revision-assets-0007"),
    ).toMatchObject({
      status: "committed",
    });
    expect(await readFile(path.join(root, manifest.path), "utf8")).toBe(content);
  });

  it("refuses relink byte substitution and manifest hash drift", async () => {
    const root = await initializedProject();
    const original = videoAsset("a".repeat(64), "assets/original.mov");
    await executeProjectCommand(root, registerCommand(original, "revision-assets-0001"), {
      revisionId: "revision-assets-0002",
      now: commandNow,
    });
    const relink = relinkCommand("revision-assets-0002");
    const rejected = await executeProjectCommand(
      root,
      {
        ...relink,
        payload: { ...relink.payload, observedContentHash: "f".repeat(64) },
      },
      { now: commandNow },
    );
    expect(rejected).toMatchObject({ status: "failed", error: { code: "asset.relink.hash-mismatch" } });

    const content = "{}\n";
    const manifest = { ...manifestAsset(content), contentHash: "e".repeat(64) };
    const rejectedManifest = await executeProjectCommand(
      root,
      manifestCommand(manifest, content, "revision-assets-0002"),
      { now: commandNow },
    );
    expect(rejectedManifest).toMatchObject({
      status: "failed",
      error: { code: "asset.manifest.contract-invalid" },
    });
  });
});

const initializedProject = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chai-asset-command-"));
  temporaryDirectories.push(parent);
  const root = path.join(parent, "assets.chai");
  await initializeProjectFolder(root, {
    title: "Asset Commands",
    projectId: "project-assets-0001",
    revisionId: "revision-assets-0001",
    actorId: "actor-assets-0001",
    sessionId: "session-assets-0001",
    now: new Date("2026-07-15T13:20:00.000Z"),
  });
  return root;
};

const commandNow = (): Date => new Date("2026-07-15T13:21:30.000Z");

const commandBase = (baseRevisionId: string, suffix: string) => ({
  schemaVersion: "1.0.0" as const,
  commandId: `command-${suffix}-0001`,
  idempotencyId: `idempotency-${suffix}-0001`,
  actor: { id: "actor-assets-0001", kind: "user" as const, sessionId: "session-assets-0001" },
  projectId: "project-assets-0001",
  correlationId: `correlation-${suffix}-0001`,
  issuedAt: "2026-07-15T13:21:00.000Z",
  capability: { name: "media-assets", version: "1.0.0" },
  payloadVersion: "1.0.0" as const,
  affectedEntityIds: ["asset-video-0001"],
  declaredScope: "mutation" as const,
  validationOnly: false,
  baseRevisionId,
  authorizationId: null,
});

const registerCommand = (asset: AssetRecord, baseRevisionId: string): AssetRegisterCommand => ({
  ...commandBase(baseRevisionId, "register"),
  kind: "asset.register",
  payload: { asset },
});

const relinkCommand = (baseRevisionId: string): AssetRelinkCommand => ({
  ...commandBase(baseRevisionId, "relink"),
  kind: "asset.relink",
  payload: {
    assetId: "asset-video-0001",
    newPath: "assets/relinked.mov",
    observedContentHash: "a".repeat(64),
  },
});

const replaceCommand = (asset: AssetRecord, baseRevisionId: string): AssetReplaceCommand => ({
  ...commandBase(baseRevisionId, "replace"),
  kind: "asset.replace",
  payload: { expectedContentHash: "a".repeat(64), asset },
});

const manifestCommand = (
  asset: AssetRecord,
  content: string,
  baseRevisionId: string,
): AssetManifestUpsertCommand => ({
  ...commandBase(baseRevisionId, "manifest"),
  affectedEntityIds: [asset.id],
  kind: "asset.manifest.upsert",
  payload: { manifestType: "rights", asset, content },
});

const historyCommand = (
  snapshot: Awaited<ReturnType<typeof loadCurrentProjectRevision>>,
  kind: HistoryMoveCommand["kind"],
  suffix: string,
): HistoryMoveCommand => ({
  ...commandBase(snapshot.pointer.revisionId, suffix),
  kind,
  payload: { steps: 1 },
});

const videoAsset = (contentHash: string, assetPath: string): AssetRecord => ({
  id: "asset-video-0001",
  path: assetPath,
  contentHash,
  kind: "video",
  durationFrames: serializeBigInt(300n),
  fps: normalizeRational(30n, 1n),
  hasAudio: true,
  hasAlpha: false,
  variableFrameRate: false,
  rights: "owned",
  validationState: "valid",
});

const manifestAsset = (content: string): AssetRecord => ({
  id: "asset-rights-manifest-0001",
  path: "assets/metadata/asset-rights.json",
  contentHash: createHash("sha256").update(content).digest("hex"),
  kind: "data",
  durationFrames: null,
  fps: null,
  hasAudio: false,
  hasAlpha: false,
  variableFrameRate: false,
  rights: "owned",
  validationState: "valid",
});
