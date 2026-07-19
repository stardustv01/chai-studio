import { timingSafeEqual } from "node:crypto";
import { securityIdentity } from "./identity.js";

export type DestructiveOperation =
  "source.delete" | "project.replace-all" | "cache.cleanup" | "external.publish";

export interface DestructiveAuthorization {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly operation: DestructiveOperation;
  readonly projectId: string;
  readonly targetIds: readonly string[];
  readonly scopeIdentity: string;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

export class DestructiveAuthorizationRegistry {
  readonly #records = new Map<string, DestructiveAuthorization>();

  issue(input: {
    readonly id: string;
    readonly operation: Exclude<DestructiveOperation, "external.publish">;
    readonly projectId: string;
    readonly targetIds: readonly string[];
    readonly issuedBy: string;
    readonly issuedAt: Date;
    readonly expiresAt: Date;
  }): DestructiveAuthorization {
    if (input.targetIds.length === 0) throw new Error("Destructive authorization requires explicit targets.");
    if (input.expiresAt <= input.issuedAt) throw new Error("Destructive authorization expiry is invalid.");
    if (this.#records.has(input.id)) throw new Error("Destructive authorization id already exists.");
    const record: DestructiveAuthorization = {
      schemaVersion: "1.0.0",
      id: input.id,
      operation: input.operation,
      projectId: input.projectId,
      targetIds: [...new Set(input.targetIds)].sort(),
      scopeIdentity: securityIdentity({
        operation: input.operation,
        projectId: input.projectId,
        targetIds: [...new Set(input.targetIds)].sort(),
      }),
      issuedBy: input.issuedBy,
      issuedAt: input.issuedAt.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      consumedAt: null,
    };
    this.#records.set(record.id, record);
    return structuredClone(record);
  }

  consume(input: {
    readonly id: string;
    readonly operation: DestructiveOperation;
    readonly projectId: string;
    readonly targetIds: readonly string[];
    readonly now: Date;
  }): DestructiveAuthorization {
    if (input.operation === "external.publish") {
      throw new Error("External publishing/uploading is unsupported in the personal local baseline.");
    }
    const current = this.#records.get(input.id);
    if (current === undefined) throw new Error("Destructive authorization does not exist.");
    if (current.consumedAt !== null) throw new Error("Destructive authorization was already consumed.");
    if (Date.parse(current.expiresAt) <= input.now.getTime())
      throw new Error("Destructive authorization expired.");
    const requested = securityIdentity({
      operation: input.operation,
      projectId: input.projectId,
      targetIds: [...new Set(input.targetIds)].sort(),
    });
    if (!safeEqual(requested, current.scopeIdentity))
      throw new Error("Destructive authorization scope mismatch.");
    const consumed = { ...current, consumedAt: input.now.toISOString() };
    this.#records.set(current.id, consumed);
    return structuredClone(consumed);
  }
}

const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
