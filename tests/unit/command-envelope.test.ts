import { describe, expect, it } from "vitest";
import {
  assertCommandEnvelope,
  normalizeRational,
  serializeBigInt,
  validateCommandEnvelope,
  type ProjectCommandEnvelope,
} from "../../packages/schema/src/index.js";

const sha = "a".repeat(64);
const common = {
  schemaVersion: "1.0.0",
  commandId: "command-envelope-0001",
  idempotencyId: "idempotency-envelope-0001",
  actor: { id: "actor-user-0001", kind: "user", sessionId: "session-local-0001" },
  projectId: "project-envelope-0001",
  correlationId: "correlation-envelope-0001",
  issuedAt: "2026-07-15T00:00:00.000Z",
  capability: { name: "project-core", version: "1.0.0" },
  payloadVersion: "1.0.0",
  affectedEntityIds: ["project-envelope-0001"],
  validationOnly: false,
} as const;

describe("typed command envelope", () => {
  const validCommands: readonly ProjectCommandEnvelope[] = [
    {
      ...common,
      kind: "read.inspect",
      declaredScope: "read",
      baseRevisionId: null,
      authorizationId: null,
      payload: { query: "active timeline" },
    },
    {
      ...common,
      kind: "capture.create",
      declaredScope: "capture",
      baseRevisionId: null,
      authorizationId: null,
      payload: { label: "Director review" },
    },
    {
      ...common,
      kind: "project.rename",
      declaredScope: "mutation",
      baseRevisionId: "revision-envelope-0001",
      authorizationId: null,
      payload: { title: "First Light" },
    },
    {
      ...common,
      kind: "asset.register",
      declaredScope: "mutation",
      baseRevisionId: "revision-envelope-0001",
      authorizationId: null,
      payload: {
        asset: {
          id: "asset-envelope-0001",
          path: "assets/first-light.mov",
          contentHash: sha,
          kind: "video",
          durationFrames: serializeBigInt(100n),
          fps: normalizeRational(30_000n, 1_001n),
          hasAudio: true,
          hasAlpha: false,
          variableFrameRate: false,
          rights: "owned",
          validationState: "valid",
        },
      },
    },
    {
      ...common,
      kind: "source.edit",
      declaredScope: "source-edit",
      baseRevisionId: "revision-envelope-0001",
      authorizationId: null,
      payload: { path: "scenes/remotion/scene.tsx", expectedHash: sha, content: "export {};" },
    },
    {
      ...common,
      kind: "history.undo",
      declaredScope: "mutation",
      baseRevisionId: "revision-envelope-0001",
      authorizationId: null,
      payload: { steps: 1 },
    },
    {
      ...common,
      kind: "review.edit",
      declaredScope: "mutation",
      baseRevisionId: "revision-envelope-0001",
      authorizationId: null,
      payload: {
        operation: { kind: "review.bundle.delete", bundleId: "bundle-envelope-0001" },
      },
    },
    {
      ...common,
      kind: "version.create",
      declaredScope: "mutation",
      baseRevisionId: "revision-envelope-0001",
      authorizationId: null,
      payload: { name: "Review", outputId: null },
    },
    {
      ...common,
      kind: "lifecycle.transition",
      declaredScope: "mutation",
      baseRevisionId: "revision-envelope-0001",
      authorizationId: null,
      payload: { to: "qa_passed", outputId: "output-0001", evidenceHashes: [sha], exceptionIds: [] },
    },
  ];

  it.each(validCommands)("accepts schema-valid $kind commands", (command) => {
    expect(validateCommandEnvelope(command)).toEqual({ ok: true, value: command });
    expect(assertCommandEnvelope(command).kind).toBe(command.kind);
  });

  it("requires a current base revision for mutations", () => {
    const invalid = {
      ...common,
      kind: "project.rename",
      declaredScope: "mutation",
      baseRevisionId: null,
      authorizationId: null,
      payload: { title: "No base" },
    };
    expect(validateCommandEnvelope(invalid).ok).toBe(false);
  });

  it("requires explicit scoped authorization for destructive replacement", () => {
    const invalid = {
      ...common,
      kind: "timeline.replace",
      declaredScope: "destructive",
      baseRevisionId: "revision-envelope-0001",
      authorizationId: null,
      payload: { timeline: {} },
    };
    expect(validateCommandEnvelope(invalid).ok).toBe(false);
  });

  it("rejects undeclared fields and path traversal at ingress", () => {
    const invalid = {
      ...common,
      kind: "source.edit",
      declaredScope: "source-edit",
      baseRevisionId: "revision-envelope-0001",
      authorizationId: null,
      payload: { path: "../escape.ts", expectedHash: sha, content: "", shell: true },
      surprise: true,
    };
    const result = validateCommandEnvelope(invalid);
    expect(result.ok).toBe(false);
    expect(() => assertCommandEnvelope(invalid)).toThrow(/structural validation/);
  });
});
