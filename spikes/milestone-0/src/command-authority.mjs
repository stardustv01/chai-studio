import { createHash } from "node:crypto";

const capabilities = Object.freeze({
  "project.inspect": { authorization: "automatic", rateCategory: "read" },
  "capture.create": { authorization: "automatic", rateCategory: "capture" },
  "project.mutate": { authorization: "validated", rateCategory: "mutation" },
  "source.edit": { authorization: "validated-source-transaction", rateCategory: "mutation" },
  "project.delete": { authorization: "explicit", rateCategory: "destructive" },
  "project.replace-all": { authorization: "explicit", rateCategory: "destructive" },
  "external.publish": { authorization: "unsupported-personal-baseline", rateCategory: "external" },
});

const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;
const identity = (value) => createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");

export class CommandAuthority {
  constructor() {
    this.replays = new Map();
  }

  authorize(envelope, context) {
    const capability = capabilities[envelope.capability];
    if (!capability) throw Object.assign(new Error("unknown capability"), { code: "UNKNOWN_CAPABILITY" });
    for (const field of ["commandId", "idempotencyId", "actorId", "sessionId", "projectId", "correlationId"]) {
      if (!envelope[field]) throw Object.assign(new Error(`missing ${field}`), { code: "INVALID_COMMAND_ENVELOPE" });
    }
    if (capability.authorization === "unsupported-personal-baseline") {
      throw Object.assign(new Error("publishing is outside the personal local baseline"), { code: "CAPABILITY_UNSUPPORTED" });
    }
    if (capability.rateCategory !== "read" && capability.rateCategory !== "capture" && envelope.baseRevisionId !== context.currentRevisionId) {
      throw Object.assign(new Error("stale base revision; refresh required"), { code: "STALE_CONTEXT", retryable: true });
    }
    if (capability.authorization === "validated-source-transaction" && !context.sourceTransactionActive) {
      throw Object.assign(new Error("active source-edit transaction required"), { code: "SOURCE_TRANSACTION_REQUIRED" });
    }
    if (capability.authorization === "explicit" && context.explicitAuthorizationId !== envelope.authorizationId) {
      throw Object.assign(new Error("explicit authorization required"), { code: "EXPLICIT_AUTHORIZATION_REQUIRED" });
    }

    const replayKey = `${envelope.actorId}:${envelope.idempotencyId}`;
    const commandIdentity = identity(envelope);
    const replay = this.replays.get(replayKey);
    if (replay && replay.commandIdentity !== commandIdentity) {
      throw Object.assign(new Error("idempotency identifier reused for different command"), { code: "IDEMPOTENCY_CONFLICT" });
    }
    if (replay) return { ...replay, replayed: true };
    const decision = Object.freeze({
      authorized: true,
      replayed: false,
      commandIdentity,
      authorization: capability.authorization,
      rateCategory: capability.rateCategory,
      audit: {
        commandId: envelope.commandId,
        actorId: envelope.actorId,
        sessionId: envelope.sessionId,
        projectId: envelope.projectId,
        baseRevisionId: envelope.baseRevisionId ?? null,
        correlationId: envelope.correlationId,
        affectedEntities: envelope.affectedEntities ?? [],
      },
    });
    this.replays.set(replayKey, decision);
    return decision;
  }
}

export { capabilities as commandCapabilities };
