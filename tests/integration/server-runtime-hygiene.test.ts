import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectSessionService,
  RegenerableStudioIndex,
  RuntimeHygieneService,
  StudioEventHub,
  StudioJobRegistry,
  createStudioServer,
  type ApiSuccessEnvelope,
  type DiskPreflightReport,
  type RuntimeHygieneStatus,
  type RuntimeOrphanRecord,
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

describe("runtime hygiene API", () => {
  it("preflights disk, watches changes, quarantines safe orphans, and shuts down cleanly", async () => {
    const parent = await temporaryDirectory();
    const projects = new ProjectSessionService();
    const jobs = new StudioJobRegistry();
    const events = new StudioEventHub();
    const index = new RegenerableStudioIndex({ projects, jobs });
    const runtime = new RuntimeHygieneService({
      projects,
      jobs,
      index,
      events,
      minimumFreeBytes: 0,
      orphanAgeMs: 0,
    });
    const token = "runtime-api-session-token-abcdefghijklmnopqrstuvwxyz";
    let origins: readonly string[] = [];
    const server = createStudioServer({
      sessionToken: token,
      allowedOrigins: () => origins,
      projectService: projects,
      jobRegistry: jobs,
      eventHub: events,
      indexService: index,
      runtimeHygiene: runtime,
    });
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    origins = [`http://127.0.0.1:${port.toString()}`];
    const request = requestFor(port, token, origins[0] ?? "");
    const projectPath = path.join(parent, "Runtime API.chai");
    expect(
      (
        await request("/api/v1/projects/create", {
          method: "POST",
          body: JSON.stringify({ targetPath: projectPath, title: "Runtime API" }),
        })
      ).status,
    ).toBe(201);

    const activated = await request("/api/v1/runtime/activate", { method: "POST" });
    expect((await activated.json()) as ApiSuccessEnvelope<RuntimeHygieneStatus>).toMatchObject({
      data: { active: true, watchedDirectoryCount: 7, tempRelativePath: ".chai-cache/tmp" },
    });
    const disk = await request("/api/v1/runtime/disk");
    expect((await disk.json()) as ApiSuccessEnvelope<DiskPreflightReport>).toMatchObject({
      data: { passed: true, minimumFreeBytes: 0 },
    });

    const tempFile = path.join(projectPath, ".chai-cache", "tmp", "abandoned.tmp");
    await writeFile(tempFile, "temporary");
    const staging = path.join(projectPath, "revisions", ".staging-orphan-runtime-0001");
    await mkdir(staging, { recursive: true });
    const incompleteRender = path.join(projectPath, "renders", "output-incomplete-runtime-0001");
    await mkdir(incompleteRender, { recursive: true });
    const orphansResponse = await request("/api/v1/runtime/orphans");
    const orphans = ((await orphansResponse.json()) as ApiSuccessEnvelope<RuntimeOrphanRecord[]>).data;
    expect(orphans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: ".chai-cache/tmp/abandoned.tmp", quarantineEligible: true }),
        expect.objectContaining({ kind: "revision-staging", quarantineEligible: false }),
        expect.objectContaining({ kind: "incomplete-render", quarantineEligible: true }),
      ]),
    );
    await expect(runtime.quarantine("revisions/.staging-orphan-runtime-0001", "unsafe")).rejects.toThrow(
      /refuses authority-adjacent/,
    );
    const quarantined = await request("/api/v1/runtime/orphans/quarantine", {
      method: "POST",
      body: JSON.stringify({ relativePath: ".chai-cache/tmp/abandoned.tmp", reason: "stale temp" }),
    });
    expect(quarantined.status).toBe(200);
    await expect(readFile(tempFile)).rejects.toThrow();

    await writeFile(path.join(projectPath, "assets", "watch-me.txt"), "changed");
    await waitFor(() => runtime.changes().some((change) => change.relativePath === "assets/watch-me.txt"));
    expect((await request("/api/v1/runtime/changes")).status).toBe(200);
    expect(events.replay("0").some((event) => event.type === "filesystem.changed")).toBe(true);

    const snapshot = await projects.snapshot();
    jobs.enqueue({
      id: "job-runtime-shutdown-0001",
      kind: "asset.inspect",
      correlationId: "correlation-runtime-shutdown-0001",
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      task: ({ signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("cancelled for shutdown"));
            },
            { once: true },
          );
          void resolve;
        }),
    });
    await Promise.resolve();
    await runtime.shutdown();
    expect(jobs.get("job-runtime-shutdown-0001").status).toBe("cancelled");
    expect(runtime.status().active).toBe(false);
    const autosave = JSON.parse(await readFile(path.join(projectPath, "autosave-metadata.json"), "utf8")) as {
      cleanShutdown: boolean;
    };
    expect(autosave.cleanShutdown).toBe(true);
  });
});

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for runtime file watcher.");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
};

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
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-runtime-api-"));
  temporaryDirectories.push(directory);
  return directory;
};
