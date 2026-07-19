import { describe, expect, it } from "vitest";
import { ChaiError, createCorrelationId } from "../../packages/diagnostics/src/index.js";
import {
  apiFailure,
  apiSuccess,
  assertApiEnvelope,
  requestCorrelationId,
  studioApiVersion,
} from "../../apps/studio-server/src/index.js";

describe("versioned Studio API envelope", () => {
  it("wraps success and error results with shared correlation semantics", () => {
    const correlationId = createCorrelationId();
    expect(assertApiEnvelope(apiSuccess(correlationId, { value: 42 }))).toEqual({
      apiVersion: studioApiVersion,
      ok: true,
      correlationId,
      data: { value: 42 },
    });
    const error = new ChaiError({
      category: "media",
      code: "media.fixture",
      correlationId,
      stage: "inspect",
      entityId: "asset-0001",
      message: "Fixture failed.",
      repairHint: "Repair the fixture.",
      details: { retryAfterMs: 100 },
    });
    expect(assertApiEnvelope(apiFailure(error, true))).toMatchObject({
      ok: false,
      correlationId,
      error: {
        category: "media",
        code: "media.fixture",
        stage: "inspect",
        entityId: "asset-0001",
        retryable: true,
        repairHint: "Repair the fixture.",
      },
    });
  });

  it("accepts a valid caller correlation ID and replaces malformed input", () => {
    const valid = createCorrelationId();
    expect(requestCorrelationId(valid)).toBe(valid);
    expect(requestCorrelationId("not-a-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
