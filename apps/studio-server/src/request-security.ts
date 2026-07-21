import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { ChaiError } from "@chai-studio/diagnostics";
import {
  authenticateBridgeRequest,
  authorizeBridgeRequest,
  type BridgeAuthorization,
  type BridgeCapability,
} from "@chai-studio/bridge";

export interface StudioRequestSecurityPolicy {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly allowedOrigins: () => readonly string[];
  readonly publicPaths: ReadonlySet<string>;
  readonly bridgeAuthorization?: BridgeAuthorization;
  readonly bridgeCapability?: (method: string, path: string) => BridgeCapability | null;
}

export interface StudioRequestSecurityResult {
  readonly origin: string | null;
  readonly corsOrigin: string | null;
  readonly authentication: "public" | "session" | "bridge";
}

export const authorizeStudioRequest = (input: {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly correlationId: string;
  readonly policy: StudioRequestSecurityPolicy;
}): StudioRequestSecurityResult => {
  assertLoopbackHost(input.headers.host, input.correlationId);
  const origin = singleHeader(input.headers.origin);
  const allowedOrigins = input.policy.allowedOrigins();
  if (origin !== null && !allowedOrigins.includes(origin)) {
    throw securityError(
      "server.origin-forbidden",
      input.correlationId,
      "request-origin",
      `Local request origin is not approved: ${origin}.`,
      "Use the Studio UI origin reported at startup.",
    );
  }
  if (input.method === "OPTIONS") return { origin, corsOrigin: origin, authentication: "public" };
  let authentication: StudioRequestSecurityResult["authentication"] = "public";
  if (!input.policy.publicPaths.has(input.path)) {
    const token =
      bearerToken(input.headers.authorization) ?? singleHeader(input.headers["x-chai-session-token"]);
    const sessionAuthenticated = token !== null && secureEquals(token, input.policy.sessionToken);
    let bridgeAuthenticated = false;
    if (!sessionAuthenticated && token !== null && input.policy.bridgeAuthorization !== undefined) {
      const capability = input.policy.bridgeCapability?.(input.method, input.path) ?? null;
      if (capability !== null) {
        try {
          authenticateBridgeRequest(input.policy.bridgeAuthorization, { token });
          authorizeBridgeRequest(input.policy.bridgeAuthorization, { token, capability });
          bridgeAuthenticated = true;
        } catch (cause) {
          let tokenRecognized: boolean;
          try {
            authenticateBridgeRequest(input.policy.bridgeAuthorization, { token });
            tokenRecognized = true;
          } catch {
            tokenRecognized = false;
          }
          if (tokenRecognized) {
            throw securityError(
              "server.bridge-capability-forbidden",
              input.correlationId,
              "request-authorization",
              cause instanceof Error ? cause.message : "Bridge capability is not granted.",
              "Use a discovered command granted by the current bridge attachment.",
            );
          }
        }
      } else {
        let tokenRecognized: boolean;
        try {
          authenticateBridgeRequest(input.policy.bridgeAuthorization, { token });
          tokenRecognized = true;
        } catch {
          tokenRecognized = false;
        }
        if (tokenRecognized) {
          throw securityError(
            "server.bridge-capability-forbidden",
            input.correlationId,
            "request-authorization",
            `The local bridge is not authorized for ${input.method} ${input.path}.`,
            "Use a discovery-backed bridge command; owner approval and delivery remain UI-authorized.",
          );
        }
      }
    }
    if (!sessionAuthenticated && !bridgeAuthenticated) {
      throw securityError(
        "server.session-token-invalid",
        input.correlationId,
        "request-authentication",
        "A valid local Studio session token is required.",
        "Read the current startup session token and retry the local request.",
      );
    }
    authentication = bridgeAuthenticated ? "bridge" : "session";
    if (bridgeAuthenticated && origin !== null) {
      throw securityError(
        "server.bridge-origin-forbidden",
        input.correlationId,
        "request-authentication",
        "Bridge credentials cannot be used by an Origin-bearing browser request.",
        "Use the owner-private local CLI attachment without a browser Origin header.",
      );
    }
    if (origin !== null && isMutation(input.method)) {
      const csrfToken = singleHeader(input.headers["x-chai-csrf-token"]);
      if (csrfToken === null || !secureEquals(csrfToken, input.policy.csrfToken)) {
        throw securityError(
          "server.csrf-token-invalid",
          input.correlationId,
          "request-csrf",
          "Browser mutation requires the current anti-CSRF token.",
          "Refresh the Studio session and retry from the approved local UI.",
        );
      }
    }
  }
  return { origin, corsOrigin: origin, authentication };
};

const isMutation = (method: string): boolean =>
  method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

export const assertLoopbackBindHost = (host: string): "127.0.0.1" | "::1" => {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("Studio server can bind only to IPv4 or IPv6 loopback.");
  }
  return host;
};

const assertLoopbackHost = (hostHeader: string | undefined, correlationId: string): void => {
  if (hostHeader === undefined) {
    throw securityError(
      "server.host-missing",
      correlationId,
      "request-host",
      "HTTP Host header is required.",
      "Use the loopback Studio server URL.",
    );
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    hostname = "";
  }
  if (hostname !== "127.0.0.1" && hostname !== "::1" && hostname !== "[::1]" && hostname !== "localhost") {
    throw securityError(
      "server.host-forbidden",
      correlationId,
      "request-host",
      `Non-loopback Host header is forbidden: ${hostHeader}.`,
      "Connect through 127.0.0.1, ::1, or localhost.",
    );
  }
};

const bearerToken = (authorization: string | undefined): string | null => {
  if (authorization === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(authorization);
  return match?.[1] ?? null;
};

const singleHeader = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : (value?.[0] ?? null);

const secureEquals = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const securityError = (
  code: string,
  correlationId: string,
  stage: string,
  message: string,
  repairHint: string,
): ChaiError =>
  new ChaiError({
    category: "security",
    code,
    correlationId,
    stage,
    message,
    repairHint,
  });
