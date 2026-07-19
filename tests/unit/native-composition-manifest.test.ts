import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssetApiService } from "../../apps/studio-server/src/asset-service.js";
import { StudioJobRegistry } from "../../apps/studio-server/src/job-registry.js";
import { validateNativeCompositionManifest } from "../../apps/studio-server/src/native-composition-runtime.js";
import { ProjectSessionService } from "../../apps/studio-server/src/project-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("native composition manifest boundary", () => {
  it("registers a structurally valid project-contained manifest without executing it", async () => {
    const parent = await temporaryDirectory("chai-native-manifest-");
    const root = path.join(parent, "Native.chai");
    const projects = new ProjectSessionService();
    await projects.create({ targetPath: root, title: "Native" });
    const sourceRoot = path.join(root, "native", "hyperframes");
    const manifestDirectory = path.join(root, "assets", "native");
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(manifestDirectory, { recursive: true }),
    ]);
    await writeFile(path.join(sourceRoot, "index.html"), "<main data-hf-composition='Native'></main>");
    const manifestPath = path.join(manifestDirectory, "native.chai-composition.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        engine: "hyperframes",
        projectRoot: "native/hyperframes",
        entryFile: "index.html",
        compositionId: "Native",
        declaredFps: { numerator: "30", denominator: "1" },
        variableOverrides: {},
        approvedNetworkResources: [],
      }),
    );
    const snapshot = await projects.snapshot();
    const assets = new AssetApiService({ projects, jobs: new StudioJobRegistry() });
    const imported = await assets.importAsset({
      sourcePath: manifestPath,
      id: "asset-native-manifest-0001",
      kind: "composition",
      rights: "owned",
      context: {
        baseRevisionId: snapshot.pointer.revisionId,
        idempotencyId: "idempotency-native-manifest-0001",
        actor: { id: "actor-native-manifest-0001", kind: "user", sessionId: "session-native-manifest" },
      },
    });
    expect(imported).toMatchObject({
      receipt: { status: "committed" },
      asset: {
        kind: "composition",
        validationState: "valid",
        fps: { numerator: "30", denominator: "1" },
      },
    });
    const inspectionJob = await assets.enqueueInspection(
      imported.asset.id,
      "correlation-native-manifest-inspection-0001",
    );
    await expect(assets.jobs().wait(inspectionJob.id)).resolves.toMatchObject({
      status: "completed",
      result: {
        engine: "hyperframes",
        compositionId: "Native",
        fps: { numerator: "30", denominator: "1" },
      },
    });

    const replacementManifestPath = path.join(manifestDirectory, "replacement.chai-composition.json");
    await writeFile(
      replacementManifestPath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        engine: "hyperframes",
        projectRoot: "native/hyperframes",
        entryFile: "index.html",
        compositionId: "NativeReplacement",
        declaredFps: { numerator: "24", denominator: "1" },
        variableOverrides: {},
        approvedNetworkResources: [],
      }),
    );
    const afterImport = await projects.snapshot();
    const replacement = await assets.replace({
      assetId: imported.asset.id,
      sourcePath: replacementManifestPath,
      expectedContentHash: imported.asset.contentHash,
      kind: "composition",
      rights: "owned",
      context: {
        baseRevisionId: afterImport.pointer.revisionId,
        idempotencyId: "idempotency-native-manifest-replacement-0001",
        actor: {
          id: "actor-native-manifest-0001",
          kind: "user",
          sessionId: "session-native-manifest",
        },
      },
    });
    expect(replacement.status).toBe("committed");
    expect((await projects.snapshot()).assets.assets[0]).toMatchObject({
      id: imported.asset.id,
      validationState: "valid",
      fps: { numerator: "24", denominator: "1" },
    });
  });

  it("rejects a manifest whose source root escapes through a symlink", async () => {
    const parent = await temporaryDirectory("chai-native-symlink-");
    const root = path.join(parent, "project");
    const external = path.join(parent, "external");
    await Promise.all([mkdir(root, { recursive: true }), mkdir(external, { recursive: true })]);
    await writeFile(path.join(external, "index.html"), "<main></main>");
    await symlink(external, path.join(root, "linked-source"));
    await writeFile(
      path.join(root, "manifest.json"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        engine: "hyperframes",
        projectRoot: "linked-source",
        entryFile: "index.html",
        compositionId: "Escaped",
        declaredFps: { numerator: "30", denominator: "1" },
        variableOverrides: {},
        approvedNetworkResources: [],
      }),
    );
    await expect(
      validateNativeCompositionManifest({ projectRoot: root, manifestPath: "manifest.json" }),
    ).rejects.toThrow("resolves outside its project root");
  });
});

const temporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};
