import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createStudioServer,
  startStudioServer,
  studioApiVersion,
  type ApiSuccessEnvelope,
  type StudioHealth,
} from "../../apps/studio-server/src/index.js";

const openServers = [] as ReturnType<typeof createStudioServer>[];
const closeStartedServers: (() => Promise<void>)[] = [];
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      async (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
  await Promise.all(closeStartedServers.splice(0).map((close) => close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("studio server integration", () => {
  it("serves a correlated local health contract", async () => {
    const server = createStudioServer();
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port.toString()}/api/health`);
    const payload = (await response.json()) as ApiSuccessEnvelope<StudioHealth>;
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      apiVersion: studioApiVersion,
      ok: true,
      data: { status: "ok", service: "studio-server", contractVersion: studioApiVersion },
    });
    expect(payload.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("starts with one lease, an ephemeral token, exact origins, and authenticated private routes", async () => {
    const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), "chai-server-startup-"));
    temporaryDirectories.push(runtimeDirectory);
    const started = await startStudioServer({ preferredPort: 0, runtimeDirectory });
    closeStartedServers.push(() => started.close());
    const baseUrl = `http://127.0.0.1:${started.report.port.toString()}`;
    expect(started.report).toMatchObject({
      status: "ready",
      host: "127.0.0.1",
      instancePolicy: "single-app",
    });
    expect(started.report.sessionTokenFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(started.report)).not.toContain(started.sessionToken);

    const health = await fetch(`${baseUrl}/api/health`);
    const healthPayload = (await health.json()) as ApiSuccessEnvelope<StudioHealth>;
    expect(healthPayload.data.instanceId).toBe(started.report.instanceId);

    const unauthorized = await fetch(`${baseUrl}/api/v1/session`);
    expect(unauthorized.status).toBe(401);
    const forbiddenOrigin = await fetch(`${baseUrl}/api/v1/session`, {
      headers: {
        authorization: `Bearer ${started.sessionToken}`,
        origin: "https://evil.example",
      },
    });
    expect(forbiddenOrigin.status).toBe(403);
    const authorized = await fetch(`${baseUrl}/api/v1/session`, {
      headers: {
        authorization: `Bearer ${started.sessionToken}`,
        origin: started.report.origins[0] ?? baseUrl,
      },
    });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("access-control-allow-origin")).toBe(started.report.origins[0]);
  });

  it("accepts only an explicitly allowlisted loopback UI origin", async () => {
    const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), "chai-server-ui-origin-"));
    temporaryDirectories.push(runtimeDirectory);
    const uiOrigin = "http://127.0.0.1:4173";
    const started = await startStudioServer({
      preferredPort: 0,
      runtimeDirectory,
      allowedUiOrigins: [uiOrigin],
    });
    closeStartedServers.push(() => started.close());
    const baseUrl = `http://127.0.0.1:${started.report.port.toString()}`;
    const authorized = await fetch(`${baseUrl}/api/v1/session`, {
      headers: { authorization: `Bearer ${started.sessionToken}`, origin: uiOrigin },
    });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("access-control-allow-origin")).toBe(uiOrigin);
    const nearbyButUnapproved = await fetch(`${baseUrl}/api/v1/session`, {
      headers: {
        authorization: `Bearer ${started.sessionToken}`,
        origin: "http://127.0.0.1:4174",
      },
    });
    expect(nearbyButUnapproved.status).toBe(403);
  });

  it("rejects non-loopback UI origins before opening a server", async () => {
    await expect(
      startStudioServer({ preferredPort: 0, allowedUiOrigins: ["https://evil.example"] }),
    ).rejects.toThrow(/exact loopback/u);
  });
});
