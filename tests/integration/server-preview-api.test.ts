import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startStudioServer,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
  type PreviewSessionStatus,
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

describe("preview HTTP API", () => {
  it("loads, reports, controls, preloads, diagnoses, conflict-checks, and unloads a session", async () => {
    const parent = await temporaryDirectory();
    const started = await startStudioServer({
      preferredPort: 0,
      runtimeDirectory: path.join(parent, "runtime"),
    });
    startedServers.push(started);
    const request = requestFor(started);

    const beforeLoad = await request("/api/v1/preview/sessions/current");
    expect(beforeLoad.status).toBe(409);
    expect((await beforeLoad.json()) as ApiErrorEnvelope).toMatchObject({
      error: { code: "server.preview-not-loaded" },
    });

    const projectPath = path.join(parent, "Preview API.chai");
    expect(
      (
        await request("/api/v1/projects/create", {
          method: "POST",
          body: JSON.stringify({ targetPath: projectPath, title: "Preview API" }),
        })
      ).status,
    ).toBe(201);

    const loaded = await request("/api/v1/preview/sessions/load", { method: "POST" });
    expect(loaded.status).toBe(201);
    let status = ((await loaded.json()) as ApiSuccessEnvelope<PreviewSessionStatus>).data;
    expect(status).toMatchObject({
      synchronized: true,
      state: {
        durationFrames: "0",
        currentFrame: "0",
        stateVersion: 1,
        adapters: {
          remotion: { status: "not-required" },
          hyperframes: { status: "not-required" },
        },
      },
    });

    const paused = await request("/api/v1/preview/sessions/current/transport", {
      method: "POST",
      body: JSON.stringify({ action: "pause", expectedStateVersion: status.state.stateVersion }),
    });
    status = ((await paused.json()) as ApiSuccessEnvelope<PreviewSessionStatus>).data;
    expect(status.state.stateVersion).toBe(2);

    const stale = await request("/api/v1/preview/sessions/current/seek", {
      method: "POST",
      body: JSON.stringify({ frame: "0", expectedStateVersion: 1 }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()) as ApiErrorEnvelope).toMatchObject({
      error: { code: "server.preview-state-conflict" },
    });

    const quality = await request("/api/v1/preview/sessions/current/quality", {
      method: "POST",
      body: JSON.stringify({
        quality: "full",
        truthMode: "rendered-fidelity",
        expectedStateVersion: status.state.stateVersion,
      }),
    });
    status = ((await quality.json()) as ApiSuccessEnvelope<PreviewSessionStatus>).data;
    expect(status.state).toMatchObject({
      quality: "full",
      truthMode: "rendered-fidelity",
      approximationWarningVisible: false,
    });

    const preloaded = await request("/api/v1/preview/sessions/current/preload", {
      method: "POST",
      body: JSON.stringify({
        beforeFrames: 20,
        afterFrames: 40,
        expectedStateVersion: status.state.stateVersion,
      }),
    });
    expect(preloaded.status).toBe(200);
    expect((await request("/api/v1/preview/sessions/current/adapters")).status).toBe(200);
    expect((await request("/api/v1/preview/sessions/unload", { method: "POST" })).status).toBe(200);
    expect((await request("/api/v1/preview/sessions/current")).status).toBe(409);
  });

  it("serves authenticated compositor pixels with revision and frame identity", async () => {
    const parent = await temporaryDirectory();
    const started = await startStudioServer({
      preferredPort: 0,
      runtimeDirectory: path.join(parent, "runtime-program"),
    });
    startedServers.push(started);
    const request = requestFor(started);
    const projectPath = path.join(parent, "Program API.chai");
    const created = await request("/api/v1/projects/create", {
      method: "POST",
      body: JSON.stringify({ targetPath: projectPath, title: "Program API", starter: "showcase" }),
    });
    expect(created.status).toBe(201);
    const snapshotResponse = await request("/api/v1/projects/current/snapshot");
    const snapshot = (
      (await snapshotResponse.json()) as ApiSuccessEnvelope<
        Readonly<{ pointer: Readonly<{ revisionId: string }> }>
      >
    ).data;

    const frame = await request("/api/v1/preview/program-frame?frame=150");
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-type")).toBe("image/png");
    expect(frame.headers.get("x-chai-program-frame")).toBe("150");
    expect(frame.headers.get("x-chai-revision-id")).toBe(snapshot.pointer.revisionId);
    expect(frame.headers.get("x-chai-artifact-sha256")).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      Buffer.from(await frame.arrayBuffer())
        .subarray(1, 4)
        .toString("ascii"),
    ).toBe("PNG");

    const invalid = await request("/api/v1/preview/program-frame?frame=450");
    expect(invalid.status).toBe(400);
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-preview-api-"));
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
