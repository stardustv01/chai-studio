import { describe, expect, it } from "vitest";
import { createCorrelationId } from "../../packages/diagnostics/src/index.js";
import { createBridgeAuthorization } from "../../packages/bridge/src/index.js";
import { assertLoopbackBindHost, authorizeStudioRequest } from "../../apps/studio-server/src/index.js";

const token = "local-session-token-abcdefghijklmnopqrstuvwxyz";

describe("loopback Studio request security", () => {
  it("allows public health and authenticated native or approved-origin requests", () => {
    expect(
      authorizeStudioRequest({
        method: "GET",
        path: "/api/health",
        headers: { host: "127.0.0.1:4317" },
        correlationId: createCorrelationId(),
        policy: policy(),
      }),
    ).toEqual({ origin: null, corsOrigin: null, authentication: "public" });
    expect(
      authorizeStudioRequest({
        method: "GET",
        path: "/api/health",
        headers: { host: "[::1]:4317" },
        correlationId: createCorrelationId(),
        policy: policy(),
      }),
    ).toEqual({ origin: null, corsOrigin: null, authentication: "public" });
    expect(
      authorizeStudioRequest({
        method: "GET",
        path: "/api/v1/session",
        headers: {
          host: "localhost:4317",
          origin: "http://localhost:4317",
          authorization: `Bearer ${token}`,
        },
        correlationId: createCorrelationId(),
        policy: policy(),
      }),
    ).toEqual({
      origin: "http://localhost:4317",
      corsOrigin: "http://localhost:4317",
      authentication: "session",
    });
  });

  it("rejects LAN bind hosts, host-header tricks, foreign origins, and invalid tokens", () => {
    expect(() => assertLoopbackBindHost("0.0.0.0")).toThrow(/loopback/);
    expect(() => authorize({ host: "192.168.1.10:4317", authorization: `Bearer ${token}` })).toThrow(
      /Non-loopback Host/,
    );
    expect(() =>
      authorize({
        host: "127.0.0.1:4317",
        origin: "https://evil.example",
        authorization: `Bearer ${token}`,
      }),
    ).toThrow(/origin is not approved/);
    expect(() =>
      authorize({ host: "127.0.0.1:4317", authorization: "Bearer wrong-token-value-12345" }),
    ).toThrow(/session token/);
  });

  it("requires a matching anti-CSRF token for approved-origin mutations", () => {
    expect(() =>
      authorizeStudioRequest({
        method: "POST",
        path: "/api/v1/commands",
        headers: {
          host: "localhost:4317",
          origin: "http://localhost:4317",
          authorization: `Bearer ${token}`,
        },
        correlationId: createCorrelationId(),
        policy: policy(),
      }),
    ).toThrow(/anti-CSRF/);
    expect(
      authorizeStudioRequest({
        method: "POST",
        path: "/api/v1/commands",
        headers: {
          host: "localhost:4317",
          origin: "http://localhost:4317",
          authorization: `Bearer ${token}`,
          "x-chai-csrf-token": token,
        },
        correlationId: createCorrelationId(),
        policy: policy(),
      }),
    ).toEqual({
      origin: "http://localhost:4317",
      corsOrigin: "http://localhost:4317",
      authentication: "session",
    });
  });

  it("identifies owner-private bridge requests and rejects ungranted capabilities or browser origins", () => {
    const bridgeToken = "bridge-token-abcdefghijklmnopqrstuvwxyz-123456";
    const bridgeAuthorization = createBridgeAuthorization({
      id: "bridge-authorization-test",
      sessionId: "bridge-session-test",
      token: bridgeToken,
      capabilities: ["status.read"],
      issuedAt: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const bridgePolicy = {
      ...policy(),
      bridgeAuthorization,
      bridgeCapability: () => "status.read" as const,
    };
    expect(
      authorizeStudioRequest({
        method: "GET",
        path: "/api/v1/session",
        headers: { host: "127.0.0.1:4317", authorization: `Bearer ${bridgeToken}` },
        correlationId: createCorrelationId(),
        policy: bridgePolicy,
      }),
    ).toEqual({ origin: null, corsOrigin: null, authentication: "bridge" });
    expect(() =>
      authorizeStudioRequest({
        method: "POST",
        path: "/api/v1/renders",
        headers: { host: "127.0.0.1:4317", authorization: `Bearer ${bridgeToken}` },
        correlationId: createCorrelationId(),
        policy: { ...bridgePolicy, bridgeCapability: () => "render.control" as const },
      }),
    ).toThrow(/does not grant render.control/u);
    expect(() =>
      authorizeStudioRequest({
        method: "GET",
        path: "/api/v1/session",
        headers: {
          host: "localhost:4317",
          origin: "http://localhost:4317",
          authorization: `Bearer ${bridgeToken}`,
        },
        correlationId: createCorrelationId(),
        policy: bridgePolicy,
      }),
    ).toThrow(/Origin-bearing browser/u);
  });
});

const policy = () => ({
  sessionToken: token,
  csrfToken: token,
  allowedOrigins: () => ["http://localhost:4317"],
  publicPaths: new Set(["/api/health"]),
});

const authorize = (headers: Record<string, string>) =>
  authorizeStudioRequest({
    method: "GET",
    path: "/api/v1/session",
    headers,
    correlationId: createCorrelationId(),
    policy: policy(),
  });
