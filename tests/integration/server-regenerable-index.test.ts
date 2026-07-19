import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectSessionService,
  RegenerableStudioIndex,
  StudioJobRegistry,
  createStudioServer,
  type ApiSuccessEnvelope,
  type IndexedAssetRow,
  type StudioIndexStatus,
} from "../../apps/studio-server/src/index.js";

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

describe("regenerable SQLite index API", () => {
  it("rebuilds jobs, assets, and cache metadata from file authority after deletion", async () => {
    const parent = await temporaryDirectory();
    const projects = new ProjectSessionService();
    const jobs = new StudioJobRegistry();
    const index = new RegenerableStudioIndex({ projects, jobs });
    const token = "index-api-session-token-abcdefghijklmnopqrstuvwxyz";
    let origins: readonly string[] = [];
    const server = createStudioServer({
      sessionToken: token,
      allowedOrigins: () => origins,
      projectService: projects,
      jobRegistry: jobs,
      indexService: index,
    });
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    origins = [`http://127.0.0.1:${port.toString()}`];
    const request = requestFor(port, token, origins[0] ?? "");
    const projectPath = path.join(parent, "Index API.chai");
    expect(
      (
        await request("/api/v1/projects/create", {
          method: "POST",
          body: JSON.stringify({ targetPath: projectPath, title: "Index API" }),
        })
      ).status,
    ).toBe(201);

    const sourcePath = path.join(projectPath, "assets", "searchable-source.png");
    await writeFile(
      sourcePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    let snapshot = await projects.snapshot();
    const imported = await request("/api/v1/assets/import", {
      method: "POST",
      body: JSON.stringify({
        sourcePath,
        id: "asset-index-image-0001",
        kind: "image",
        rights: "owned",
        context: {
          baseRevisionId: snapshot.pointer.revisionId,
          idempotencyId: "idempotency-index-import-0001",
          actor: actor(),
        },
      }),
    });
    expect(imported.status).toBe(200);
    snapshot = await projects.snapshot();
    const cacheDirectory = path.join(projectPath, ".chai-cache", "media", "fixture");
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(path.join(cacheDirectory, "cached.bin"), "cached-bytes");

    jobs.enqueue({
      id: "job-index-fixture-0001",
      kind: "asset.inspect",
      correlationId: "correlation-index-job-0001",
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      task: () => Promise.resolve({ indexed: true }),
    });
    await jobs.wait("job-index-fixture-0001");

    const rebuilt = await request("/api/v1/index/rebuild", { method: "POST" });
    expect(rebuilt.status).toBe(200);
    const status = ((await rebuilt.json()) as ApiSuccessEnvelope<StudioIndexStatus>).data;
    expect(status).toMatchObject({
      authority: false,
      open: true,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      jobCount: 1,
      assetCount: 1,
      cacheEntryCount: 2,
    });

    const searched = await request("/api/v1/index/assets/search", {
      method: "POST",
      body: JSON.stringify({ text: "searchable", limit: 20 }),
    });
    expect(((await searched.json()) as ApiSuccessEnvelope<IndexedAssetRow[]>).data).toMatchObject([
      { id: "asset-index-image-0001", path: "assets/searchable-source.png" },
    ]);

    const databaseFile = path.join(projectPath, ".chai-cache", "indexes", "studio.sqlite");
    const before = await stat(databaseFile);
    const regenerated = await request("/api/v1/index", { method: "DELETE" });
    expect((await regenerated.json()) as ApiSuccessEnvelope<StudioIndexStatus>).toMatchObject({
      data: { authority: false, assetCount: 1, jobCount: 1, cacheEntryCount: 2 },
    });
    const after = await stat(databaseFile);
    expect(after.ino).not.toBe(before.ino);
    expect(index.searchAssets("searchable")).toHaveLength(1);
  });
});

const actor = () => ({
  id: "actor-index-api-0001",
  kind: "user",
  sessionId: "session-index-api-0001",
});

const requestFor =
  (port: number, token: string, origin: string) =>
  (endpoint: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-chai-csrf-token", token);
    headers.set("content-type", "application/json");
    headers.set("origin", origin);
    return fetch(`http://127.0.0.1:${port.toString()}${endpoint}`, { ...init, headers });
  };

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-index-api-"));
  temporaryDirectories.push(directory);
  return directory;
};
