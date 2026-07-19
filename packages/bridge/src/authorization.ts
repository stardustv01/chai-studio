import { createHash, timingSafeEqual } from "node:crypto";

export type BridgeCapability =
  | "status.read"
  | "project.read"
  | "project.write"
  | "selection.read"
  | "selection.write"
  | "asset.read"
  | "asset.write"
  | "asset.process"
  | "context.read"
  | "capture.create"
  | "annotation.read"
  | "annotation.write"
  | "review.read"
  | "review.write"
  | "preview.control"
  | "render.control"
  | "qa.read"
  | "qa.run"
  | "receipt.read"
  | "command.execute"
  | "job.read"
  | "job.control"
  | "source.edit";

export interface BridgeAuthorization {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly capabilities: readonly BridgeCapability[];
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export const createBridgeAuthorization = (input: {
  readonly id: string;
  readonly sessionId: string;
  readonly token: string;
  readonly capabilities: readonly BridgeCapability[];
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}): BridgeAuthorization => {
  if (input.token.length < 32) throw new Error("Bridge token must contain at least 32 characters.");
  if (input.expiresAt <= input.issuedAt) throw new Error("Bridge authorization expiry is invalid.");
  return {
    schemaVersion: "1.0.0",
    id: input.id,
    sessionId: input.sessionId,
    tokenHash: hashToken(input.token),
    capabilities: [...new Set(input.capabilities)].sort(),
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  };
};

export const authorizeBridgeRequest = (
  authorization: BridgeAuthorization,
  input: Readonly<{ token: string; capability: BridgeCapability; now?: Date }>,
): void => {
  authenticateBridgeRequest(authorization, input);
  if (!authorization.capabilities.includes(input.capability)) {
    throw new Error(`Bridge authorization does not grant ${input.capability}.`);
  }
};

export const authenticateBridgeRequest = (
  authorization: BridgeAuthorization,
  input: Readonly<{ token: string; now?: Date }>,
): void => {
  const now = input.now ?? new Date();
  if (Date.parse(authorization.expiresAt) <= now.getTime()) throw new Error("Bridge authorization expired.");
  const expected = Buffer.from(authorization.tokenHash, "hex");
  const observed = Buffer.from(hashToken(input.token), "hex");
  if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) {
    throw new Error("Bridge authorization token is invalid.");
  }
};

const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
