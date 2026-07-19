import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AssetApiService,
  ProjectSessionService,
  StudioJobRegistry,
  createStudioServer,
  type ApiSuccessEnvelope,
  type StudioJobSnapshot,
} from "../../apps/studio-server/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];
const openServers: ReturnType<typeof createStudioServer>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("asset HTTP API", () => {
  it("streams browser uploads into the project and commits their registry identity", async () => {
    const parent = await temporaryDirectory();
    const projects = new ProjectSessionService();
    const jobs = new StudioJobRegistry();
    const assets = new AssetApiService({ projects, jobs, maximumUploadBytes: 128 });
    const token = "asset-upload-session-token-abcdefghijklmnopqrstuvwxyz";
    let origins: readonly string[] = [];
    const server = createStudioServer({
      sessionToken: token,
      allowedOrigins: () => origins,
      projectService: projects,
      assetService: assets,
      jobRegistry: jobs,
    });
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    origins = [`http://127.0.0.1:${port.toString()}`];
    const request = requestFor(port, token, origins[0] ?? "");
    const preflight = await fetch(`http://127.0.0.1:${port.toString()}/api/v1/assets/upload`, {
      method: "OPTIONS",
      headers: {
        origin: origins[0] ?? "",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "content-type,x-chai-file-name,x-chai-asset-id,x-chai-asset-kind,x-chai-asset-rights,x-chai-base-revision-id,x-chai-idempotency-id",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("x-chai-idempotency-id");
    const projectPath = path.join(parent, "Uploaded Asset.chai");
    await request("/api/v1/projects/create", {
      method: "POST",
      body: JSON.stringify({ targetPath: projectPath, title: "Uploaded Asset" }),
    });
    const snapshot = await projects.snapshot();
    const uploadBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await request("/api/v1/assets/upload", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-chai-file-name": encodeURIComponent("real source.png"),
        "x-chai-asset-id": "asset-upload-image-0001",
        "x-chai-asset-kind": "image",
        "x-chai-asset-rights": "owned",
        "x-chai-base-revision-id": snapshot.pointer.revisionId,
        "x-chai-idempotency-id": "idempotency-asset-upload-0001",
      },
      body: new Blob([uploadBytes], { type: "application/octet-stream" }),
    });
    expect(upload.status, await upload.clone().text()).toBe(201);
    const payload = (await upload.json()) as ApiSuccessEnvelope<{
      storedPath: string;
      bytesWritten: number;
    }>;
    expect(payload.data).toMatchObject({
      storedPath: "assets/imported/asset-upload-image-0001-real source.png",
      bytesWritten: uploadBytes.byteLength,
    });
    expect(await readFile(path.join(projectPath, payload.data.storedPath))).toEqual(uploadBytes);
    expect((await projects.snapshot()).assets.assets).toEqual([
      expect.objectContaining({
        id: "asset-upload-image-0001",
        path: payload.data.storedPath,
        kind: "image",
        rights: "owned",
        validationState: "valid",
      }),
    ]);

    const sourceFrame = await request("/api/v1/assets/asset-upload-image-0001/source-frame?frame=0", {
      method: "GET",
    });
    expect(sourceFrame.status, await sourceFrame.clone().text()).toBe(200);
    expect(sourceFrame.headers.get("content-type")).toBe("image/png");
    expect(sourceFrame.headers.get("x-chai-source-frame")).toBe("0");
    expect(sourceFrame.headers.get("x-chai-artifact-sha256")).toMatch(/^[a-f0-9]{64}$/u);
    expect(Buffer.from(await sourceFrame.arrayBuffer()).byteLength).toBeGreaterThan(100);

    const invalidSourceFrame = await request("/api/v1/assets/asset-upload-image-0001/source-frame?frame=1", {
      method: "GET",
    });
    expect(invalidSourceFrame.status).toBe(400);

    const oversized = await request("/api/v1/assets/upload", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-chai-file-name": encodeURIComponent("too-large.mov"),
        "x-chai-asset-id": "asset-upload-video-0002",
        "x-chai-asset-kind": "video",
        "x-chai-asset-rights": "unknown",
        "x-chai-base-revision-id": (await projects.snapshot()).pointer.revisionId,
        "x-chai-idempotency-id": "idempotency-asset-upload-0002",
      },
      body: "x".repeat(129),
    });
    expect(oversized.status).toBe(400);
    expect((await projects.snapshot()).assets.assets).toHaveLength(1);
  });

  it("imports, inspects, proxies, generates views, searches, reports usage, relinks, replaces, and commits rights", async () => {
    const parent = await temporaryDirectory();
    const projects = new ProjectSessionService();
    const jobs = new StudioJobRegistry();
    const invalidations: Readonly<{ assetId: string; beforeHash: string; afterHash: string }>[] = [];
    const assets = new AssetApiService({
      projects,
      jobs,
      onAssetCacheInvalidation: (event) => {
        invalidations.push(event);
        return Promise.resolve();
      },
      inspectMedia: (input) =>
        Promise.resolve({
          schemaVersion: "1.0.0",
          contentHash: input.contentHash,
          probeVersion: "fixture",
          containerNames: ["mov"],
          containerLongName: "Fixture",
          durationSeconds: normalizeRational(10n, 1n),
          sizeBytes: "6",
          videoStreams: [],
          audioStreams: [],
          hasVideo: true,
          hasAudio: false,
          hasAlpha: false,
          variableFrameRate: false,
        }),
      generateProxy: (input) =>
        Promise.resolve({
          schemaVersion: "1.0.0",
          sourceAssetId: input.sourceAsset.id,
          sourceContentHash: input.sourceAsset.contentHash,
          proxyContentHash: "f".repeat(64),
          profileId: input.profile.id,
          profileFingerprint: "e".repeat(64),
          cacheKey: "d".repeat(64),
          outputFilePath: input.outputFilePath,
          timeMap: {
            schemaVersion: "1.0.0",
            sourceContentHash: input.sourceAsset.contentHash,
            proxyContentHash: "f".repeat(64),
            targetFrameRate: input.profile.targetFrameRate,
            proxyFrameCount: input.proxyFrameCount,
            variableFrameRateSource: false,
            mappings: [],
          },
        }),
      generateView: (input) =>
        Promise.resolve({
          schemaVersion: "1.0.0",
          kind: input.profile.kind,
          sourceContentHash: input.sourceContentHash,
          profileFingerprint: "c".repeat(64),
          cacheKey: "b".repeat(64),
          outputPath: path.join(input.cacheDirectory, "fixture"),
          outputContentHash: "a".repeat(64),
        }),
    });
    const token = "asset-api-session-token-abcdefghijklmnopqrstuvwxyz";
    let origins: readonly string[] = [];
    const server = createStudioServer({
      sessionToken: token,
      allowedOrigins: () => origins,
      projectService: projects,
      assetService: assets,
      jobRegistry: jobs,
    });
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    origins = [`http://127.0.0.1:${port.toString()}`];
    const request = requestFor(port, token, origins[0] ?? "");
    const projectPath = path.join(parent, "Asset API.chai");
    await request("/api/v1/projects/create", {
      method: "POST",
      body: JSON.stringify({ targetPath: projectPath, title: "Asset API" }),
    });
    const sourcePath = path.join(projectPath, "assets", "source.mov");
    const relinkPath = path.join(projectPath, "assets", "relinked.mov");
    const replacementPath = path.join(projectPath, "assets", "replacement.mov");
    await writeFile(sourcePath, "source");
    await writeFile(relinkPath, "source");
    await writeFile(replacementPath, "replacement");

    let snapshot = await projects.snapshot();
    const imported = await request("/api/v1/assets/import", {
      method: "POST",
      body: JSON.stringify({
        sourcePath,
        id: "asset-api-video-0001",
        kind: "video",
        rights: "owned",
        context: context(snapshot.pointer.revisionId, "import"),
      }),
    });
    expect(imported.status).toBe(200);
    snapshot = await projects.snapshot();

    const inspect = await request("/api/v1/assets/asset-api-video-0001/inspect", { method: "POST" });
    expect(inspect.status).toBe(202);
    const inspectJob = (await inspect.json()) as ApiSuccessEnvelope<StudioJobSnapshot>;
    expect(await jobs.wait(inspectJob.data.id)).toMatchObject({ status: "completed" });

    for (const [endpoint, body] of [
      [
        "proxy",
        {
          profile: {
            id: "proxy-api-720p",
            width: 1280,
            height: 720,
            targetFrameRate: normalizeRational(25n, 1n),
            videoCodec: "h264",
            audioCodec: "aac",
            quality: 24,
            container: "mp4",
          },
          sourceFrames: [],
          proxyFrameCount: "0",
        },
      ],
      [
        "thumbnail",
        {
          profile: {
            kind: "thumbnail",
            width: 320,
            height: 180,
            atSeconds: normalizeRational(0n, 1n),
            format: "png",
          },
        },
      ],
      ["waveform", { profile: { kind: "waveform", width: 512, channels: "mono", sampleRate: 16000 } }],
    ] as const) {
      const response = await request(`/api/v1/assets/asset-api-video-0001/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(response.status, endpoint).toBe(202);
      const payload = (await response.json()) as ApiSuccessEnvelope<StudioJobSnapshot>;
      expect(await jobs.wait(payload.data.id)).toMatchObject({ status: "completed" });
    }

    const defaultProxy = await request("/api/v1/assets/asset-api-video-0001/proxy-default", {
      method: "POST",
    });
    expect(defaultProxy.status).toBe(202);
    const defaultProxyJob = (await defaultProxy.json()) as ApiSuccessEnvelope<StudioJobSnapshot>;
    const completedDefaultProxy = await jobs.wait(defaultProxyJob.data.id);
    expect(completedDefaultProxy).toMatchObject({
      kind: "asset.proxy",
      status: "completed",
    });
    expect(completedDefaultProxy.result).toMatchObject({ profileId: "studio-default-720p-cfr" });

    const search = await request("/api/v1/assets/search", {
      method: "POST",
      body: JSON.stringify({
        query: { text: "source", sortBy: "name", direction: "ascending", offset: 0, limit: 20 },
      }),
    });
    expect((await search.json()) as ApiSuccessEnvelope<{ total: number }>).toMatchObject({
      data: { total: 1 },
    });
    expect((await request("/api/v1/assets/asset-api-video-0001/usage")).status).toBe(200);
    const invalidSearch = await request("/api/v1/assets/search", {
      method: "POST",
      body: JSON.stringify({
        query: { sortBy: "mystery", direction: "ascending", offset: 0, limit: 20 },
      }),
    });
    expect(invalidSearch.status).toBe(400);

    const relinked = await request("/api/v1/assets/asset-api-video-0001/relink", {
      method: "POST",
      body: JSON.stringify({
        sourcePath: relinkPath,
        context: context(snapshot.pointer.revisionId, "relink"),
      }),
    });
    expect(relinked.status).toBe(200);
    snapshot = await projects.snapshot();
    expect(snapshot.assets.assets[0]?.path).toBe("assets/relinked.mov");
    const originalContentHash = snapshot.assets.assets[0]?.contentHash ?? "";

    const expectedContentHash = snapshot.assets.assets[0]?.contentHash ?? "";
    const replaced = await request("/api/v1/assets/asset-api-video-0001/replace", {
      method: "POST",
      body: JSON.stringify({
        sourcePath: replacementPath,
        expectedContentHash,
        kind: "video",
        rights: "owned",
        context: context(snapshot.pointer.revisionId, "replace"),
      }),
    });
    expect(replaced.status).toBe(200);
    snapshot = await projects.snapshot();

    const rights = await request("/api/v1/assets/rights", {
      method: "POST",
      body: JSON.stringify({
        records: [rightsRecord("asset-api-video-0001")],
        context: context(snapshot.pointer.revisionId, "rights"),
      }),
    });
    expect(rights.status).toBe(200);
    const afterRights = await projects.snapshot();
    expect(afterRights.project.sources["scenes/shared/project-dependencies/asset-rights.json"]).toBeDefined();
    expect(afterRights.assets.assets.some((asset) => asset.id === "asset-rights-manifest-0001")).toBe(true);
    expect(invalidations).toEqual([
      {
        assetId: "asset-api-video-0001",
        beforeHash: originalContentHash,
        afterHash: originalContentHash,
      },
      {
        assetId: "asset-api-video-0001",
        beforeHash: originalContentHash,
        afterHash: afterRights.assets.assets.find((asset) => asset.id === "asset-api-video-0001")
          ?.contentHash,
      },
    ]);
  });
});

const context = (baseRevisionId: string, suffix: string) => ({
  baseRevisionId,
  idempotencyId: `idempotency-asset-api-${suffix}`,
  actor: { id: "actor-asset-api-0001", kind: "user", sessionId: "session-asset-api-0001" },
});

const rightsRecord = (assetId: string) => ({
  assetId,
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
  reviewedAt: "2026-07-15T13:40:00.000Z",
  reviewedBy: "actor-asset-api-0001",
});

const requestFor =
  (port: number, token: string, origin: string) =>
  (endpoint: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-chai-csrf-token", token);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    headers.set("origin", origin);
    return fetch(`http://127.0.0.1:${port.toString()}${endpoint}`, { ...init, headers });
  };

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-asset-api-"));
  temporaryDirectories.push(directory);
  return directory;
};
