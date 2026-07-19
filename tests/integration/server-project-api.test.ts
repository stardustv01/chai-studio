import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startStudioServer,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
  type StartedStudioServer,
} from "../../apps/studio-server/src/index.js";

const temporaryDirectories: string[] = [];
const startedServers: StartedStudioServer[] = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((started) => started.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("project HTTP API", () => {
  it("exposes create, recent, snapshot, history, versions, migration, repair, and close contracts", async () => {
    const parent = await temporaryDirectory();
    const runtimeDirectory = path.join(parent, "runtime");
    const projectPath = path.join(parent, "API Film.chai");
    const started = await startStudioServer({ preferredPort: 0, runtimeDirectory });
    startedServers.push(started);
    const request = requestFor(started);

    const invalid = await request("/api/v1/projects/create", {
      method: "POST",
      body: "{}",
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()) as ApiErrorEnvelope).toMatchObject({
      ok: false,
      error: { code: "server.request-invalid", retryable: false },
    });

    const created = await request("/api/v1/projects/create", {
      method: "POST",
      body: JSON.stringify({ targetPath: projectPath, title: "API Film" }),
    });
    expect(created.status).toBe(201);
    const createdPayload = (await created.json()) as ApiSuccessEnvelope<Record<string, unknown>>;
    expect(createdPayload).toMatchObject({ ok: true, data: { rootPath: projectPath } });

    for (const endpoint of [
      "/api/v1/projects/recent",
      "/api/v1/projects/current/snapshot",
      "/api/v1/projects/current/revisions",
      "/api/v1/projects/current/named-versions",
      "/api/v1/projects/current/migration-report",
      "/api/v1/projects/current/repair-report",
    ]) {
      const response = await request(endpoint);
      expect(response.status, endpoint).toBe(200);
      expect((await response.json()) as ApiSuccessEnvelope<unknown>).toMatchObject({ ok: true });
    }

    expect((await request("/api/v1/projects/close", { method: "POST" })).status).toBe(200);
    const afterClose = await request("/api/v1/projects/current/snapshot");
    expect(afterClose.status).toBe(409);
    expect((await afterClose.json()) as ApiErrorEnvelope).toMatchObject({
      error: { code: "server.project-not-open" },
    });
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-project-api-"));
  temporaryDirectories.push(directory);
  return directory;
};

const requestFor =
  (started: StartedStudioServer) =>
  (endpoint: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${started.sessionToken}`);
    headers.set("x-chai-csrf-token", started.sessionToken);
    headers.set("content-type", "application/json");
    headers.set("origin", started.report.origins[0] ?? `http://127.0.0.1:${started.report.port.toString()}`);
    return fetch(`http://127.0.0.1:${started.report.port.toString()}${endpoint}`, {
      ...init,
      headers,
    });
  };
